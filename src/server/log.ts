/**
 * Structured logs (12-security §2 item 6): one JSON object per line on stdout/stderr, so `docker compose logs`
 * stays greppable. Everything passes through `redact` first:
 * - values under sensitive keys (authorization, cookie, token, password, secret, key, session) → "[redacted]";
 * - query strings are cut from URLs (the student API carries its token there);
 * - 13-digit runs (a national ID shape) are masked;
 * - CSV content and student names are never passed to the logger in the first place (callers log counts only).
 * Dependency-free on purpose: the worker bundle and the web app share it.
 */
type Level = 'info' | 'warn' | 'error';
export type Fields = Record<string, unknown>;

const SENSITIVE_KEY = /authorization|cookie|token|passw(or)?d|secret|api[-_]?key|^key$|session|vapid|private/i;
const URL_QUERY = /(https?:\/\/[^\s"'?#]+)\?[^\s"'#]*/gi;
const NATIONAL_ID = /(^|[^0-9])[0-9]{13}(?![0-9])/g;
const MAX_DEPTH = 5;

export function redactString(s: string): string {
  return s.replace(URL_QUERY, '$1?[redacted]').replace(NATIONAL_ID, '$1[redacted-13]');
}

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[depth]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error)
    return redact({ name: value.name, message: value.message, stack: value.stack, cause: value.cause }, depth + 1);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>))
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  return out;
}

/** The JSON line for one entry (exported for the redaction test). */
export function formatEntry(level: Level, msg: string, fields: Fields = {}, at = new Date()): string {
  return JSON.stringify({ time: at.toISOString(), level, msg: redactString(msg), ...(redact(fields) as Fields) });
}

function write(level: Level, msg: string, fields?: Fields) {
  const line = formatEntry(level, msg, fields);
  if (level === 'info') process.stdout.write(`${line}\n`);
  else process.stderr.write(`${line}\n`);
}

export const log = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, err?: unknown, fields?: Fields) => write('error', msg, { ...fields, err }),
};
