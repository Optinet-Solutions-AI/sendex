#!/usr/bin/env node
/**
 * Weekly logical backup of the Sendex database.
 *
 * Runs `pg_dump` in custom format (compressed, restorable table by table), writes the file
 * under BACKUP_DIR, prints its size and sha256, and, when the R2_* variables are set, uploads
 * it to the bucket and prunes old objects so only BACKUP_KEEP remain.
 *
 * Environment
 *   DATABASE_DIRECT_URL or DATABASE_URL   source database (direct connection, not the pooler)
 *   BACKUP_DIR                            local folder, default ./backups
 *   PG_DUMP                               command, default "pg_dump"; may contain spaces
 *                                         (on Windows with WSL: "wsl -d Ubuntu -- pg_dump")
 *   R2_ACCOUNT_ID R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY   optional upload target
 *   BACKUP_PREFIX                         object key prefix, default "postgres/"
 *   BACKUP_KEEP                           objects to keep per prefix, default 8
 *
 * See docs/engineering/runbooks/backups.md.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

export function backupFileName(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `sendex-${stamp}.dump`;
}

/** Objects to delete so that at most `keep` of the newest remain. */
export function objectsToPrune(objects, keep) {
  const sorted = [...objects].sort((a, b) => b.lastModified - a.lastModified);
  return sorted.slice(keep);
}

/** Hide the password in a connection string before logging it. */
export function redactUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<invalid url>";
  }
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function upload(file, key, env) {
  const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = await import(
    "@aws-sdk/client-s3"
  );
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  await client.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: createReadStream(file),
      ContentType: "application/octet-stream",
    }),
  );
  const prefix = key.slice(0, key.lastIndexOf("/") + 1);
  const listed = await client.send(
    new ListObjectsV2Command({ Bucket: env.R2_BUCKET, Prefix: prefix }),
  );
  const objects = (listed.Contents ?? []).map((o) => ({
    key: o.Key,
    lastModified: o.LastModified?.getTime() ?? 0,
  }));
  const keep = Number.parseInt(env.BACKUP_KEEP ?? "8", 10);
  const prune = objectsToPrune(objects, keep);
  if (prune.length > 0) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: env.R2_BUCKET,
        Delete: { Objects: prune.map((o) => ({ Key: o.key })) },
      }),
    );
  }
  return { kept: objects.length - prune.length, pruned: prune.length };
}

async function main() {
  const env = process.env;
  const url = env.DATABASE_DIRECT_URL ?? env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL must be set");
  const dir = path.resolve(env.BACKUP_DIR ?? "backups");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, backupFileName());
  const [cmd, ...pre] = (env.PG_DUMP ?? "pg_dump").split(" ").filter(Boolean);

  console.log(`backup: dumping ${redactUrl(url)} to ${file}`);
  // The dump goes through stdout so the same command works when pg_dump runs inside WSL and
  // cannot see the Windows path.
  await new Promise((resolve, reject) => {
    const args = [...pre, "--format=custom", "--no-owner", "--no-privileges", "--dbname", url];
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "inherit"] });
    const out = createWriteStream(file);
    child.stdout.pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error(`pg_dump exited with ${code}`));
    });
  });

  const { size } = await stat(file);
  const digest = await sha256(file);
  console.log(`backup: ${size} bytes, sha256 ${digest}`);

  if (env.R2_ACCOUNT_ID && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    const key = `${env.BACKUP_PREFIX ?? "postgres/"}${path.basename(file)}`;
    const result = await upload(file, key, env);
    console.log(`backup: uploaded r2://${env.R2_BUCKET}/${key}; kept ${result.kept}, pruned ${result.pruned}`);
  } else {
    console.log("backup: R2_* not set, kept the local file only");
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error(`backup failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
