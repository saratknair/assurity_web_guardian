/**
 * Hand-written, pure five-field cron validation for GitHub Actions schedules
 * (design J.10.1). No dependencies, no I/O.
 *
 * Grammar per field: comma list of star, star/n, a, a-b, a-b/n (ascending
 * ranges, n >= 1). Names: months JAN-DEC, weekdays SUN-SAT (their own field
 * only). Rejected: `7` for Sunday, `?`, `L`, `W`, `#`, macros, wrong field
 * count, empty fields, and any gap under 5 minutes.
 */

export type CronItem =
  | { type: 'star'; step?: number }
  | { type: 'value'; value: number }
  | { type: 'range'; from: number; to: number; step?: number };

export type CronField = CronItem[];

export interface CronAst {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

export type CronParseResult =
  | { ok: true; ast: CronAst; warnings: string[] }
  | { ok: false; reason: string };

export const MAX_CRON_LENGTH = 100;
export const MIN_GAP_MINUTES = 5;

interface FieldSpec {
  key: keyof CronAst;
  label: string;
  min: number;
  max: number;
  names?: string[];
  nameBase?: number;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const SPECS: FieldSpec[] = [
  { key: 'minute', label: 'minute', min: 0, max: 59 },
  { key: 'hour', label: 'hour', min: 0, max: 23 },
  { key: 'dayOfMonth', label: 'day of month', min: 1, max: 31 },
  { key: 'month', label: 'month', min: 1, max: 12, names: MONTHS, nameBase: 1 },
  { key: 'dayOfWeek', label: 'day of week', min: 0, max: 6, names: DAYS, nameBase: 0 },
];

const ALL_NAMES = MONTHS.concat(DAYS);

function parseNumberToken(tok: string, spec: FieldSpec): number | string {
  if (/^\d+$/.test(tok)) {
    if (tok.length > 3) return `Value "${tok}" is out of range in the ${spec.label} field.`;
    const n = parseInt(tok, 10);
    if (spec.key === 'dayOfWeek' && n === 7) {
      return 'Sunday must be written as 0 or SUN; 7 is not supported by GitHub.';
    }
    if (n < spec.min || n > spec.max) {
      return `Value ${n} is out of range in the ${spec.label} field (${spec.min} to ${spec.max}).`;
    }
    return n;
  }
  const up = tok.toUpperCase();
  if (/^[A-Z]+$/.test(up)) {
    if (spec.names) {
      const idx = spec.names.indexOf(up);
      if (idx >= 0) return idx + (spec.nameBase ?? 0);
    }
    if (ALL_NAMES.indexOf(up) >= 0) {
      return `Name "${tok}" is not valid in the ${spec.label} field.`;
    }
    return `Unsupported text "${tok}" in the ${spec.label} field.`;
  }
  return `Unsupported symbol in "${tok}" in the ${spec.label} field.`;
}

function parseStep(tok: string, spec: FieldSpec): number | string {
  if (!/^\d+$/.test(tok)) return `Step "${tok}" in the ${spec.label} field must be a whole number.`;
  if (tok.length > 3) return `Step "${tok}" in the ${spec.label} field is too large.`;
  const n = parseInt(tok, 10);
  if (n < 1) return `Step in the ${spec.label} field must be at least 1.`;
  if (n > spec.max) return `Step ${n} in the ${spec.label} field is too large.`;
  return n;
}

function parseItem(raw: string, spec: FieldSpec): CronItem | string {
  if (raw === '') return `The ${spec.label} field has an empty list entry.`;
  if (/[?#]/.test(raw) || /^\d*[LW]$/i.test(raw) || /^L$/i.test(raw)) {
    return `The symbol in "${raw}" is not supported by GitHub cron (${spec.label} field).`;
  }
  let body = raw;
  let step: number | undefined;
  const slash = raw.indexOf('/');
  if (slash >= 0) {
    body = raw.slice(0, slash);
    const s = parseStep(raw.slice(slash + 1), spec);
    if (typeof s === 'string') return s;
    step = s;
  }
  if (body === '*') {
    return step === undefined ? { type: 'star' } : { type: 'star', step };
  }
  const dash = body.indexOf('-');
  if (dash >= 0) {
    const a = parseNumberToken(body.slice(0, dash), spec);
    if (typeof a === 'string') return a;
    const b = parseNumberToken(body.slice(dash + 1), spec);
    if (typeof b === 'string') return b;
    if (a > b) return `Range ${body} in the ${spec.label} field is descending; ranges must ascend.`;
    return step === undefined ? { type: 'range', from: a, to: b } : { type: 'range', from: a, to: b, step };
  }
  if (step !== undefined) {
    return `A step in the ${spec.label} field needs "*" or a range before "/".`;
  }
  const v = parseNumberToken(body, spec);
  if (typeof v === 'string') return v;
  return { type: 'value', value: v };
}

export function parseCron(text: string): CronParseResult {
  if (typeof text !== 'string') return { ok: false, reason: 'The schedule must be text.' };
  if (text.length > MAX_CRON_LENGTH) {
    return { ok: false, reason: `The schedule is longer than ${MAX_CRON_LENGTH} characters.` };
  }
  if (/[^\x20-\x7e\t\r\n]/.test(text)) {
    return { ok: false, reason: 'The schedule may contain only plain ASCII characters.' };
  }
  const norm = text.trim().replace(/\s+/g, ' ');
  if (norm === '') return { ok: false, reason: 'The schedule is empty.' };
  if (norm.charAt(0) === '@') {
    return { ok: false, reason: 'Macros such as @daily are not supported by GitHub; use five fields.' };
  }
  const parts = norm.split(' ');
  if (parts.length !== 5) {
    return { ok: false, reason: `A schedule needs exactly 5 fields; found ${parts.length}.` };
  }
  const ast = {} as CronAst;
  for (let i = 0; i < 5; i++) {
    const spec = SPECS[i];
    const items: CronField = [];
    for (const raw of parts[i].split(',')) {
      const it = parseItem(raw, spec);
      if (typeof it === 'string') return { ok: false, reason: it };
      items.push(it);
    }
    ast[spec.key] = items;
  }
  const gap = minGapMinutes(ast);
  if (gap < MIN_GAP_MINUTES) {
    return { ok: false, reason: 'GitHub does not run schedules more often than every 5 minutes.' };
  }
  const warnings: string[] = [];
  const mins = expandField(ast.minute, SPECS[0]);
  if (mins.length === 1 && mins[0] === 0) {
    warnings.push('A schedule at minute 0 may be delayed at busy times.');
  }
  if (!isUnrestricted(ast.dayOfMonth) && !isUnrestricted(ast.dayOfWeek)) {
    warnings.push('Day of month and day of week are both set; either one may match.');
  }
  return { ok: true, ast, warnings };
}

function isUnrestricted(f: CronField): boolean {
  return f.length === 1 && f[0].type === 'star' && f[0].step === undefined;
}

function expandField(f: CronField, spec: FieldSpec): number[] {
  const set = new Set<number>();
  for (const it of f) {
    if (it.type === 'value') set.add(it.value);
    else {
      const from = it.type === 'star' ? spec.min : it.from;
      const to = it.type === 'star' ? spec.max : it.to;
      const step = it.step ?? 1;
      for (let v = from; v <= to; v += step) set.add(v);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

function formatItem(it: CronItem): string {
  if (it.type === 'value') return String(it.value);
  const step = it.step !== undefined ? `/${it.step}` : '';
  if (it.type === 'star') return `*${step}`;
  return `${it.from}-${it.to}${step}`;
}

/** Canonical text; parseCron(formatCron(ast)) equals ast. */
export function formatCron(ast: CronAst): string {
  return SPECS.map((s) => ast[s.key].map(formatItem).join(',')).join(' ');
}

/** Smallest gap in minutes between consecutive fire times, every day eligible. */
export function minGapMinutes(ast: CronAst): number {
  const mins = expandField(ast.minute, SPECS[0]);
  const hours = expandField(ast.hour, SPECS[1]);
  const times: number[] = [];
  for (const h of hours) for (const m of mins) times.push(h * 60 + m);
  times.sort((a, b) => a - b);
  if (times.length === 0) return 1440;
  let best = times[0] + 1440 - times[times.length - 1];
  for (let i = 1; i < times.length; i++) best = Math.min(best, times[i] - times[i - 1]);
  return best;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function describeNames(f: CronField, spec: FieldSpec, names: string[], base: number): string {
  const words: string[] = [];
  for (const it of f) {
    if (it.type === 'value') words.push(names[it.value - base]);
    else if (it.type === 'range' && it.step === undefined) {
      words.push(`${names[it.from - base]} to ${names[it.to - base]}`);
    } else {
      const vals = expandItem(it, spec);
      for (const v of vals) words.push(names[v - base]);
    }
  }
  return listWords(words);
}

function expandItem(it: CronItem, spec: FieldSpec): number[] {
  return expandField([it], spec);
}

function nzSuffix(hour: number, minute: number): string {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const at = (monthIdx: number): string => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), monthIdx, 15, hour, minute));
      return fmt.format(d).replace(/[^0-9:]/g, '');
    };
    const a = at(0);
    const b = at(6);
    const clean = (s: string): string => (s.length >= 5 ? s.slice(0, 5) : s);
    const x = clean(a);
    const y = clean(b);
    if (!/^\d\d:\d\d$/.test(x) || !/^\d\d:\d\d$/.test(y)) return '';
    if (x === y) return ` (${x} in New Zealand)`;
    return ` (${x} or ${y} in New Zealand, depending on daylight saving)`;
  } catch {
    return '';
  }
}

/** Plain ASCII English summary from fixed templates. */
export function describeCron(ast: CronAst): string {
  const mins = expandField(ast.minute, SPECS[0]);
  const hours = expandField(ast.hour, SPECS[1]);
  const fixedTime = mins.length === 1 && hours.length === 1;
  let when: string;
  let nz = '';
  if (fixedTime) {
    when = `at ${pad2(hours[0])}:${pad2(mins[0])} UTC`;
    nz = nzSuffix(hours[0], mins[0]);
  } else {
    const mf = ast.minute;
    let every: string;
    if (mf.length === 1 && mf[0].type === 'star') {
      every = mf[0].step ? `Every ${mf[0].step} minutes` : 'Every minute';
    } else if (mf.length === 1 && mf[0].type === 'range' && mf[0].step) {
      every = `Every ${mf[0].step} minutes`;
    } else if (mins.length === 1) {
      every = `At minute ${mins[0]}`;
    } else {
      every = `At minutes ${mins.join(', ')}`;
    }
    const hf = ast.hour;
    let hourPart = '';
    if (isUnrestricted(hf)) {
      hourPart = '';
    } else if (hours.length === 1) {
      hourPart = `, during hour ${pad2(hours[0])}`;
    } else {
      const contiguous = hours[hours.length - 1] - hours[0] === hours.length - 1;
      hourPart = contiguous
        ? `, between ${pad2(hours[0])}:00 and ${pad2(hours[hours.length - 1])}:59 UTC`
        : `, at hours ${hours.map(pad2).join(', ')} UTC`;
    }
    when = `${every}${hourPart}`;
    if (hourPart.indexOf('UTC') < 0) when += ' UTC';
  }
  const parts: string[] = [];
  const dowAny = isUnrestricted(ast.dayOfWeek);
  const domAny = isUnrestricted(ast.dayOfMonth);
  const monAny = isUnrestricted(ast.month);
  if (!dowAny) parts.push(describeNames(ast.dayOfWeek, SPECS[4], DAY_NAMES, 0));
  if (!domAny) {
    const days = expandField(ast.dayOfMonth, SPECS[2]);
    parts.push(`day ${days.join(', ')} of the month`);
  }
  if (!monAny) parts.push(`in ${describeNames(ast.month, SPECS[3], MONTH_NAMES, 1)}`);
  let text: string;
  if (fixedTime) {
    const scope = dowAny && domAny ? 'Every day' : 'On';
    const tail = parts.length ? ` ${parts.join(', ')}` : '';
    text = scope === 'Every day'
      ? `Every day ${when}${monAny ? '' : ` ${parts.join(', ')}`}`
      : `${scope}${tail} ${when}`;
  } else {
    text = parts.length ? `${when}, ${parts.join(', ')}` : when;
  }
  return `${text}${nz}`.replace(/[^\x20-\x7e]/g, '');
}
