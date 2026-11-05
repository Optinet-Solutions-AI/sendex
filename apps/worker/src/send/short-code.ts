import { randomInt } from "node:crypto";
import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from "@sendex/core";

/** A fresh 8-character short code for a tracked link, from the unambiguous alphabet. */
export function generateShortCode(): string {
  let code = "";
  for (let i = 0; i < SHORT_CODE_LENGTH; i += 1) {
    code += SHORT_CODE_ALPHABET.charAt(randomInt(SHORT_CODE_ALPHABET.length));
  }
  return code;
}
