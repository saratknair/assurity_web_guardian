/**
 * Read and edit the one cron value in .github/workflows/guardian.yml (design J.10.2).
 * No YAML parser: the text is scanned line by line. An edit changes only the characters
 * of the cron value; quote style, indentation, comments, EOL style, final newline, and
 * every other byte are kept. Fail-closed: if the result does not verify, nothing is
 * written.
 */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { formatCron, parseCron } from "./cron.js";

export interface CronEntry {
  /** Zero-based line index. */
  line: number;
  value: string;
  /** Offsets of the value within the whole text (end exclusive). */
  start: number;
  end: number;
  quote: "" | "\"" | "'";
}

export type ReadScheduleResult =
  | { ok: true; entry: CronEntry; cron: string }
  | { ok: false; reason: string };

export type ReplaceCronResult =
  | { ok: true; text: string; cron: string }
  | { ok: false; reason: string };

export type EditScheduleResult =
  | { ok: true; cron: string; previous: string }
  | { ok: false; reason: string };

interface Line {
  content: string;
  offset: number;
}

function splitLines(text: string): Line[] {
  const out: Line[] = [];
  let pos = 0;
  const re = /\r\n|\n|\r/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ content: text.slice(pos, m.index), offset: pos });
    pos = m.index + m[0].length;
  }
  out.push({ content: text.slice(pos), offset: pos });
  return out;
}

function isBlankOrComment(s: string): boolean {
  return /^\s*(#.*)?$/.test(s);
}

function indentOf(s: string): number {
  const m = /^[ ]*/.exec(s);
  return m ? m[0].length : 0;
}

const CRON_LINE = /^(\s+-\s+cron:\s*)("([^"]*)"|'([^']*)'|([^\s"'#][^#]*?))(\s*(#.*)?)$/;
const CRON_MARK = /^\s+-\s+cron:/;

/** Find the single cron entry under on: / schedule:. */
export function readSchedule(text: string): ReadScheduleResult {
  const lines = splitLines(text);
  let i = 0;
  while (i < lines.length && !/^on:\s*(#.*)?$/.test(lines[i].content)) i++;
  if (i >= lines.length) return { ok: false, reason: "The workflow has no top-level on: section." };
  i++;
  let sched = -1;
  for (; i < lines.length; i++) {
    const c = lines[i].content;
    if (isBlankOrComment(c)) continue;
    if (indentOf(c) === 0) break;
    if (/^  schedule:\s*(#.*)?$/.test(c)) {
      sched = i;
      break;
    }
  }
  if (sched < 0) return { ok: false, reason: "The workflow has no schedule entry; edit it by hand." };
  const found: CronEntry[] = [];
  let marks = 0;
  for (let j = sched + 1; j < lines.length; j++) {
    const c = lines[j].content;
    if (isBlankOrComment(c)) continue;
    if (indentOf(c) <= 2) break;
    if (!CRON_MARK.test(c)) continue;
    marks++;
    const m = CRON_LINE.exec(c);
    if (!m) continue;
    const quote: "" | "\"" | "'" = m[3] !== undefined ? "\"" : m[4] !== undefined ? "'" : "";
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    const start = lines[j].offset + m[1].length + (quote ? 1 : 0);
    found.push({ line: j, value, start, end: start + value.length, quote });
  }
  if (marks === 0) return { ok: false, reason: "The workflow has no schedule entry; edit it by hand." };
  if (marks > 1) {
    return { ok: false, reason: "The workflow has more than one schedule; edit it by hand." };
  }
  if (found.length !== 1) {
    return { ok: false, reason: "The schedule line has an unexpected shape; edit it by hand." };
  }
  return { ok: true, entry: found[0], cron: found[0].value };
}

/** Replace only the cron value characters. Returns the new text, or a reason. */
export function replaceCron(text: string, newCron: string): ReplaceCronResult {
  const parsed = parseCron(newCron);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const cron = formatCron(parsed.ast);
  const cur = readSchedule(text);
  if (!cur.ok) return { ok: false, reason: cur.reason };
  const e = cur.entry;
  if (e.quote === "" && /^[*&!|>%@`]/.test(cron)) {
    return { ok: false, reason: "The existing schedule is unquoted and cannot hold this value; edit it by hand." };
  }
  const next = text.slice(0, e.start) + cron + text.slice(e.end);

  // Verify (fail-closed): new value read back, exactly one line differs, others identical.
  const back = readSchedule(next);
  if (!back.ok || back.cron !== cron) {
    return { ok: false, reason: "The edit could not be verified; nothing was changed." };
  }
  const a = splitLines(text);
  const b = splitLines(next);
  if (a.length !== b.length) {
    return { ok: false, reason: "The edit could not be verified; nothing was changed." };
  }
  let differing = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k].content !== b[k].content) {
      differing++;
      if (k !== e.line) return { ok: false, reason: "The edit could not be verified; nothing was changed." };
    }
  }
  if (differing > 1) return { ok: false, reason: "The edit could not be verified; nothing was changed." };
  return { ok: true, text: next, cron };
}

/**
 * Edit the workflow file at `path`. Bytes are read and written as latin1 so every
 * byte outside the cron value (including non-ASCII comments) is preserved exactly.
 * Atomic: temp file then rename.
 */
export function editSchedule(path: string, newCron: string): EditScheduleResult {
  let text: string;
  try {
    text = readFileSync(path, "latin1");
  } catch {
    return { ok: false, reason: "The workflow file could not be read." };
  }
  const cur = readSchedule(text);
  if (!cur.ok) return { ok: false, reason: cur.reason };
  const res = replaceCron(text, newCron);
  if (!res.ok) return { ok: false, reason: res.reason };
  if (res.text === text) return { ok: true, cron: res.cron, previous: cur.cron };
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, res.text, "latin1");
    renameSync(tmp, path);
  } catch {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore cleanup failure */
    }
    return { ok: false, reason: "The workflow file could not be written; nothing was changed." };
  }
  return { ok: true, cron: res.cron, previous: cur.cron };
}
