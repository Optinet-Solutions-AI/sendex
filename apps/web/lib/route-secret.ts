import { hasSecretKey, secretKeyFromEnv } from "@sendex/db";
import { authMode } from "./env";

/**
 * The key that seals custom-route credentials (D4-06): `CUSTOM_ROUTE_SECRET_KEY`. Under the
 * development auth stub (never active in production) a fixed, publicly known key stands in
 * so local work and Playwright need no secret; anything sealed with it is not protected.
 */
const DEV_KEY_HEX = "d3".repeat(32);

export function routeSecretKey(env: Record<string, string | undefined> = process.env): Buffer {
  if (hasSecretKey(env)) return secretKeyFromEnv(env);
  if (authMode(env) === "dev") return secretKeyFromEnv({ CUSTOM_ROUTE_SECRET_KEY: DEV_KEY_HEX });
  return secretKeyFromEnv(env);
}
