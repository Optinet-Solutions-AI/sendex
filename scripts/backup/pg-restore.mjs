#!/usr/bin/env node
/**
 * Restore a Sendex backup into a database and verify the row counts.
 *
 *   node scripts/backup/pg-restore.mjs --file backups/sendex-....dump --target postgresql://...
 *   node scripts/backup/pg-restore.mjs --key postgres/sendex-....dump --target postgresql://...
 *
 * `--key` downloads the object from R2 first (needs the R2_* variables). The target database
 * must exist and should be empty; the restore drops and recreates the objects it contains.
 * PG_RESTORE and PSQL default to "pg_restore" and "psql" and may contain spaces, like PG_DUMP.
 *
 * See docs/engineering/runbooks/backups.md.
 */
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const VERIFY_TABLES = [
  "organisations",
  "lists",
  "contacts",
  "campaigns",
  "laps",
  "messages",
  "ledger_entries",
];

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--file" || a === "--key" || a === "--target") {
      out[a.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  if (!out.target) throw new Error("--target <postgres url> is required");
  if (!out.file && !out.key) throw new Error("--file <dump> or --key <r2 key> is required");
  return out;
}

export function countsSql(tables) {
  return tables
    .map((t) => `select '${t}' as "table", count(*)::int as rows from "${t}"`)
    .join(" union all ");
}

function command(envName, fallback) {
  const [cmd, ...pre] = (process.env[envName] ?? fallback).split(" ").filter(Boolean);
  return { cmd, pre };
}

function run(cmd, args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: [stdin ? "pipe" : "ignore", "inherit", "inherit"] });
    if (stdin) stdin.pipe(child.stdin);
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)),
    );
  });
}

async function download(key) {
  const env = process.env;
  for (const k of ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    if (!env[k]) throw new Error(`${k} must be set to download from R2`);
  }
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  const res = await client.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  const dir = path.resolve(process.env.BACKUP_DIR ?? "backups");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, path.basename(key));
  await pipeline(res.Body, createWriteStream(file));
  console.log(`restore: downloaded ${key} to ${file}`);
  return file;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args.file ?? (await download(args.key));
  const restore = command("PG_RESTORE", "pg_restore");
  const psql = command("PSQL", "psql");

  console.log(`restore: ${path.basename(file)} into the target database`);
  // The file is streamed on stdin so a pg_restore running inside WSL need not see the path.
  await run(
    restore.cmd,
    [
      ...restore.pre,
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      "--dbname",
      args.target,
    ],
    createReadStream(file),
  );

  console.log("restore: row counts in the restored database");
  await run(psql.cmd, [
    ...psql.pre,
    "--no-psqlrc",
    "--dbname",
    args.target,
    "-c",
    countsSql(VERIFY_TABLES),
  ]);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error(`restore failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
