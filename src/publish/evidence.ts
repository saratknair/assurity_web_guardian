import { hasResidualPath, sanitizeJson } from "./sanitizer.js";
import { redact } from "../safety/redactor.js";

/**
 * Evidence sanitizer and caps for published axe violations (pure, no I/O).
 * Requirements 1.1-1.6, 1.8, 1.10, 1.12, 17.6.
 */

export interface PublishCaps {
  maxNodesPerViolation: 10;
  maxHtmlChars: 500;
  maxTargetChars: 300;
  maxFailureSummaryChars: 600;
  maxJsonBytesPerRun: number;
  maxRunBytes: number;
  maxImageBytes: number;
  maxGuidancePerRun: 100;
}

export const DEFAULT_CAPS: PublishCaps = {
  maxNodesPerViolation: 10,
  maxHtmlChars: 500,
  maxTargetChars: 300,
  maxFailureSummaryChars: 600,
  maxJsonBytesPerRun: 8 * 1024 * 1024,
  maxRunBytes: 64 * 1024 * 1024,
  maxImageBytes: 8 * 1024 * 1024,
  maxGuidancePerRun: 100,
};

export type SanitizedText =
  | { value: string; truncated: boolean; withheld: false }
  | { value: "[withheld]"; truncated: false; withheld: true; reason: string };

const WITHHELD = "[withheld]" as const;

// Control characters except \n (0x0A) and \t (0x09).
const CONTROL_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000D\u000E-\u001F\u007F-\u009F\u2028\u2029]/g;

/**
 * Sanitize one evidence string. Order matters: sanitize BEFORE truncating so a
 * secret straddling the cut point is still caught; re-scan AFTER truncating.
 */
export function sanitizeEvidenceText(
  raw: unknown,
  maxChars: number,
  opts: { collapseSpaces?: boolean } = {},
): SanitizedText {
  try {
    // 1. Coerce.
    const text = typeof raw === "string" ? raw : "";
    // 2. Redact secrets/PII and strip paths.
    const cleaned = sanitizeJson(text);
    let s = typeof cleaned === "string" ? cleaned : "";
    // 3. Strip control characters (and optionally collapse space runs). Removing
    //    characters can glue fragments into a new secret (e.g. digits next to a
    //    stripped path), so re-sanitize until the text is stable.
    const normalize = (x: string): string => {
      let y = x.replace(CONTROL_CHARS, "");
      if (opts.collapseSpaces) y = y.replace(/ {2,}/g, " ");
      return y;
    };
    s = normalize(s);
    for (let i = 0; i < 4; i++) {
      const again = sanitizeJson(s);
      const next = normalize(typeof again === "string" ? again : "");
      if (next === s) break;
      s = next;
    }
    // 4. Truncate on a code point boundary.
    let truncated = false;
    const points = Array.from(s);
    if (points.length > maxChars) {
      s = points.slice(0, Math.max(0, maxChars)).join("") + "...";
      truncated = true;
      // Truncation can leave a partial secret (e.g. a cut digit run); re-scrub.
      const again = sanitizeJson(s);
      s = normalize(typeof again === "string" ? again : "");
    }
    // 5. Residual secret/path re-scan; fail closed.
    if (redact(s) !== s || hasResidualPath(s)) {
      return { value: WITHHELD, truncated: false, withheld: true, reason: "residual-path" };
    }
    return { value: s, truncated, withheld: false };
  } catch {
    return { value: WITHHELD, truncated: false, withheld: true, reason: "sanitize-error" };
  }
}

export interface AxeNodeLike {
  html?: unknown;
  target?: unknown;
  failureSummary?: unknown;
}

export interface AxeViolationLike {
  id?: unknown;
  impact?: unknown;
  description?: unknown;
  help?: unknown;
  helpUrl?: unknown;
  tags?: unknown;
  nodes?: unknown;
}

export interface EvidenceNode {
  html: string;
  target: string;
  failureSummary: string;
  truncated: string[];
  withheld: string[];
}

export interface ViolationEvidence {
  ruleId: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  wcag: string[];
  nodeCount: number;
  omittedNodeCount: number;
  nodes: EvidenceNode[];
}

/** Flatten axe target (string | string[] | nested arrays for iframe/shadow DOM). */
function flattenTarget(t: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
  };
  walk(t);
  return parts.join(" >> ");
}

const META_MAX = 1000;

function meta(raw: unknown): string {
  const r = sanitizeEvidenceText(raw, META_MAX);
  return r.withheld ? "" : r.value;
}

export function buildViolationEvidence(
  v: AxeViolationLike,
  caps: PublishCaps = DEFAULT_CAPS,
): ViolationEvidence {
  const rawNodes: unknown[] = Array.isArray(v?.nodes) ? (v.nodes as unknown[]) : [];
  const nodeCount = rawNodes.length;
  const nodes: EvidenceNode[] = rawNodes.slice(0, caps.maxNodesPerViolation).map((n) => {
    const node = (n && typeof n === "object" ? n : {}) as AxeNodeLike;
    const truncated: string[] = [];
    const withheld: string[] = [];
    const field = (
      name: "html" | "target" | "failureSummary",
      raw: unknown,
      max: number,
      collapse = false,
    ): string => {
      const r = sanitizeEvidenceText(raw, max, { collapseSpaces: collapse });
      if (r.withheld) withheld.push(name);
      else if (r.truncated) truncated.push(name);
      return r.value;
    };
    return {
      html: field("html", node.html, caps.maxHtmlChars, true),
      target: field("target", flattenTarget(node.target), caps.maxTargetChars),
      failureSummary: field("failureSummary", node.failureSummary, caps.maxFailureSummaryChars),
      truncated,
      withheld,
    };
  });
  const tags = Array.isArray(v?.tags) ? (v.tags as unknown[]) : [];
  return {
    ruleId: meta(v?.id),
    impact: typeof v?.impact === "string" ? v.impact : null,
    description: meta(v?.description),
    help: meta(v?.help),
    helpUrl: meta(v?.helpUrl),
    wcag: tags
      .filter((t): t is string => typeof t === "string" && /^wcag\d+$/.test(t))
      .sort(),
    nodeCount,
    omittedNodeCount: nodeCount - nodes.length,
    nodes,
  };
}