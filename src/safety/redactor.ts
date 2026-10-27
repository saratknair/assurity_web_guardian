/**
 * Redactor removes tokens, credentials, personal data and secrets before any
 * telemetry/log/report write (Req 20.13, 22.1, 22.2). Pure function over the
 * record; deep-clones and replaces matched values with a placeholder.
 */
const PLACEHOLDER = "[REDACTED]";

// Keys whose values are always redacted.
const SENSITIVE_KEY = /(password|passwd|secret|token|api[_-]?key|authorization|auth|credential|cookie|session|email|phone|ssn|dob|credit|card|cvv|iban|account[_-]?number)/i;

// Value shapes that look like secrets/PII.
const SENSITIVE_VALUE: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,          // email
  /\bBearer\s+[A-Za-z0-9._-]+\b/i,                             // bearer token
  /\b[A-Za-z0-9_]{32,}\b/,                                     // long opaque token (no hyphens: avoids matching human-readable kebab-case slugs/URLs)
  /\b\d{13,19}\b/,                                             // card-ish
];

function redactString(s: string): string {
  let out = s;
  for (const re of SENSITIVE_VALUE) {
    out = out.replace(new RegExp(re, re.flags.includes("g") ? re.flags : re.flags + "g"), PLACEHOLDER);
  }
  return out;
}

export function redact<T>(value: T): T {
  return redactInner(value) as T;
}

function redactInner(value: unknown, keyHint?: string): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (keyHint && SENSITIVE_KEY.test(keyHint)) return PLACEHOLDER;
    return redactString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    if (keyHint && SENSITIVE_KEY.test(keyHint)) return PLACEHOLDER;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redactInner(v));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? PLACEHOLDER : redactInner(v, k);
    }
    return out;
  }
  return value;
}

export const REDACTED = PLACEHOLDER;
