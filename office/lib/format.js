// Time and duration text helpers. Pure functions.

const NOT_RECORDED = "not recorded";

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

// "MM:SS.t" from milliseconds (tenths truncated, negatives clamp to 0).
export function formatClock(ms) {
  const v = num(ms);
  if (v === null) return NOT_RECORDED;
  const total = Math.floor(Math.max(0, v) / 100); // tenths
  const tenths = total % 10;
  const secs = Math.floor(total / 10) % 60;
  const mins = Math.floor(total / 600);
  return pad2(mins) + ":" + pad2(secs) + "." + tenths;
}

// Short human duration: "850 ms", "1.2 s", "2 min 5 s".
export function formatDuration(ms) {
  const v = num(ms);
  if (v === null) return NOT_RECORDED;
  const m = Math.max(0, Math.round(v));
  if (m < 1000) return m + " ms";
  if (m < 60000) return (Math.round(m / 100) / 10) + " s";
  const mins = Math.floor(m / 60000);
  const secs = Math.round((m % 60000) / 1000);
  return mins + " min " + secs + " s";
}

export function formatPercent(p) {
  const v = num(p);
  if (v === null) return NOT_RECORDED;
  return v.toFixed(1) + "%";
}

export function formatCount(n) {
  const v = num(n);
  return v === null ? NOT_RECORDED : String(Math.round(v));
}

export function plural(n, one, many) {
  return n + " " + (n === 1 ? one : (many || one + "s"));
}

// Truncate to max characters with an ASCII ellipsis.
export function truncate(s, max) {
  const t = typeof s === "string" ? s : "";
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 3)) + "...";
}

export { NOT_RECORDED };
