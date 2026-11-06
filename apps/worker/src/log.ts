/**
 * Structured JSON logging: one object per line on stdout, picked up by the Fly log drain.
 * Never log a phone number; pass it through `maskPhone()` first.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type Logger = (level: LogLevel, msg: string, fields?: LogFields) => void;

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface SerialisedError {
  name: string;
  message: string;
  stack?: string;
}

export function serialiseError(err: Error): SerialisedError {
  return err.stack === undefined
    ? { name: err.name, message: err.message }
    : { name: err.name, message: err.message, stack: err.stack };
}

export interface LoggerOptions {
  /** Where lines go. Defaults to stdout. */
  write?: (line: string) => void;
  now?: () => Date;
  /** Minimum level to emit. Defaults to `LOG_LEVEL` or "info". */
  level?: LogLevel;
}

function isLogLevel(value: string | undefined): value is LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const envLevel = process.env.LOG_LEVEL;
  const minimum = LEVEL_RANK[options.level ?? (isLogLevel(envLevel) ? envLevel : "info")];

  return (level, msg, fields = {}) => {
    if (LEVEL_RANK[level] < minimum) return;
    const head = { level, msg, time: now().toISOString() };
    const record = Object.assign({}, head, fields, head);
    let line: string;
    try {
      line = JSON.stringify(record, (_key, value: unknown) =>
        value instanceof Error ? serialiseError(value) : value,
      );
    } catch (err) {
      line = JSON.stringify({
        ...head,
        logError: err instanceof Error ? err.message : String(err),
      });
    }
    write(line);
  };
}

export const log: Logger = createLogger();

// ---------------------------------------------------------------------------
// Phone masking
// ---------------------------------------------------------------------------

/**
 * ITU E.164 zone allocation: every code starting with 1 or 7 is one digit, these are two digits,
 * every other code is three digits. Enough to split a country code off without a phone library.
 */
const TWO_DIGIT_COUNTRY_CODES = new Set([
  "20",
  "27",
  "30",
  "31",
  "32",
  "33",
  "34",
  "36",
  "39",
  "40",
  "41",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "52",
  "53",
  "54",
  "55",
  "56",
  "57",
  "58",
  "60",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "81",
  "82",
  "84",
  "86",
  "90",
  "91",
  "92",
  "93",
  "94",
  "95",
  "98",
]);

function countryCodeLength(digits: string): number {
  const first = digits.charAt(0);
  if (first === "1" || first === "7") return 1;
  return TWO_DIGIT_COUNTRY_CODES.has(digits.slice(0, 2)) ? 2 : 3;
}

/**
 * Mask a phone number for logs: keep the country code (E.164 input) and the last two digits,
 * replace everything else with `*`. Too-short values are masked completely.
 */
export function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return hasPlus ? "*" : "";

  if (!hasPlus) {
    if (digits.length < 4) return "*".repeat(digits.length);
    return "*".repeat(digits.length - 2) + digits.slice(-2);
  }

  const countryCode = digits.slice(0, countryCodeLength(digits));
  const subscriber = digits.slice(countryCode.length);
  if (subscriber.length < 4) return "*".repeat(1 + digits.length);
  return `+${countryCode}${"*".repeat(subscriber.length - 2)}${subscriber.slice(-2)}`;
}
