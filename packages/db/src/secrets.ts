import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Custom-route credentials at rest (D4-06): AES-256-GCM under `CUSTOM_ROUTE_SECRET_KEY`
 * (32 bytes, hex or base64). The web app seals when a route is saved; only the worker opens
 * when it builds the provider. The sealed form is `v1.<iv>.<tag>.<ciphertext>` in base64url.
 */

const VERSION = "v1";

export class SecretKeyError extends Error {
  override readonly name = "SecretKeyError";
}

/** Decode the key from the environment; throws a clear error when it is missing or short. */
export function secretKeyFromEnv(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.CUSTOM_ROUTE_SECRET_KEY?.trim();
  if (!raw) {
    throw new SecretKeyError(
      "CUSTOM_ROUTE_SECRET_KEY is not set: custom route credentials cannot be stored or read",
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new SecretKeyError("CUSTOM_ROUTE_SECRET_KEY must be 32 bytes (64 hex characters)");
  }
  return key;
}

export function hasSecretKey(env: Record<string, string | undefined> = process.env): boolean {
  try {
    secretKeyFromEnv(env);
    return true;
  } catch {
    return false;
  }
}

/** Seal a JSON-serialisable value. */
export function sealSecret(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Open a sealed value; throws on a wrong key, a tampered value or an unknown format. */
export function openSecret<T = Record<string, string>>(sealed: string, key: Buffer): T {
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new SecretKeyError("sealed secret has an unknown format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString("utf8")) as T;
}
