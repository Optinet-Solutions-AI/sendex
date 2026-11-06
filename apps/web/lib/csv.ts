export type CsvValue = string | number | boolean | Date | null | undefined;

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  // Neutralise formula injection in spreadsheets as well as quoting.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One CSV record, RFC 4180 quoting, CRLF terminated. */
export function csvLine(values: readonly CsvValue[]): string {
  return `${values.map(escapeCell).join(",")}\r\n`;
}
