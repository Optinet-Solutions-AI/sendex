/**
 * Mask a phone number for logs: keep the leading `+`, the first two digits (the country code for
 * most European destinations) and the last two digits. Everything else becomes `*`.
 *
 * `+34600123456` -> `+34*******56`. Anything shorter than six digits is fully masked.
 */
export function maskPhone(phone: string): string {
  const plus = phone.startsWith("+") ? "+" : "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) {
    return `${plus}${"*".repeat(digits.length)}`;
  }
  const head = digits.slice(0, 2);
  const tail = digits.slice(-2);
  return `${plus}${head}${"*".repeat(digits.length - 4)}${tail}`;
}
