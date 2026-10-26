import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { AppendOnlyLog } from "./telemetry/audit-log.js";
import { ApprovalGate, SelfApprovalError, ApprovalError } from "./approval/approval-gate.js";
import {
  approveScope,
  readProposedScope,
  readApprovedScope,
  diffScope,
  groupByPathSegment,
  ScopeApprovalError,
} from "./agents/scope-store.js";
import { loadDomainConfig } from "./config/domain-config.js";

/**
 * CLI entry (Req 4.3, 29.1).
 * Subcommands: run | approve | approve-scope | list-pending | report.
 */

/** Default large-scope grouping threshold when a domain config is unavailable. */
const DEFAULT_LARGE_SCOPE_THRESHOLD = 25;

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

const PENDING = "artifacts/pending-review/spec-drafts";
const AUDIT = "artifacts/audit.jsonl";

function listPending(): void {
  if (!existsSync(resolve(PENDING))) {
    console.log("No pending drafts.");
    return;
  }
  const drafts = readdirSync(resolve(PENDING)).filter((f) => f.endsWith(".draft.md"));
  if (drafts.length === 0) {
    console.log("No pending drafts.");
    return;
  }
  console.log("Pending drafts awaiting human review:");
  for (const d of drafts) console.log("  - " + d.replace(".draft.md", "") + "  (" + d + ")");
}

function approve(args: Record<string, string>): void {
  const slug = args.slug;
  const reviewer = args.reviewer;
  const decision = (args.decision ?? "accepted") as
    | "accepted"
    | "rejected"
    | "dismissed"
    | "baseline-update-approved";
  const reason = args.reason ?? "";
  if (!slug || !reviewer) {
    console.error('Usage: approve --slug <slug> --reviewer "<name>" [--decision accepted|rejected] --reason "<why>"');
    process.exit(2);
  }
  const gate = new ApprovalGate(new AppendOnlyLog(resolve(AUDIT)), PENDING, "baselines");
  try {
    if (decision === "accepted") {
      const r = gate.approveSpecification({ slug, reviewer, decision, reason });
      console.log(`APPROVED: baseline v${r.version} -> ${r.baselinePath}`);
      console.log(`reviewId=${r.reviewId} reviewer=${reviewer}`);
    } else {
      // Record non-accept disposition against the draft.
      const reviewId = gate.disposeFinding({ slug, reviewer, decision, reason, findingId: `spec:${slug}` });
      console.log(`RECORDED decision=${decision} reviewId=${reviewId} (draft left in pending-review)`);
    }
  } catch (err) {
    if (err instanceof SelfApprovalError) {
      console.error("REJECTED (self-approval): " + err.message);
      process.exit(3);
    }
    if (err instanceof ApprovalError) {
      console.error("APPROVAL ERROR: " + err.message);
      process.exit(4);
    }
    throw err;
  }
}

/**
 * `approve-scope <domain> --reviewer "<name>"` (Req 5.4, 5.6, 12.2, 12.7).
 *
 * Human-gated promotion of a proposed scope to the authoritative approved file.
 * Reads the proposed scope, presents a summary (grouped by path segment when it
 * exceeds the domain's `largeScopeThreshold` so the human approves at group
 * level), then writes the approved file attributed to the human `--reviewer`.
 * The crawler never runs this; only an explicit invocation with a reviewer
 * writes the approved file.
 */
function approveScopeCmd(domain: string | undefined, args: Record<string, string>): void {
  const reviewer = (args.reviewer ?? "").trim();
  if (!domain || !reviewer) {
    console.error(
      'Usage: approve-scope <domain> --reviewer "<name>"\n' +
        "  Reads artifacts/pending-review/scope/<domain>.proposed.json, shows a summary,\n" +
        "  and writes config/scope/<domain>.approved.json attributed to the human reviewer.",
    );
    process.exit(2);
  }

  const proposed = readProposedScope(domain);
  if (!proposed) {
    console.error(
      `No proposed scope found for "${domain}" at ` +
        `artifacts/pending-review/scope/${domain}.proposed.json. Run discovery first.`,
    );
    process.exit(5);
    return;
  }

  // Prefer the configured threshold; fall back to a sane default if the domain
  // config cannot be loaded.
  let threshold = DEFAULT_LARGE_SCOPE_THRESHOLD;
  try {
    threshold = loadDomainConfig(domain).largeScopeThreshold;
  } catch {
    // No/invalid domain config — the default threshold stands.
  }

  const pages = proposed.pages;
  console.log(`Proposed scope for "${domain}": ${pages.length} page(s).`);

  // Show what would change against any existing approved scope.
  const current = readApprovedScope(domain);
  const diff = diffScope(current, proposed);
  console.log(
    `  vs approved: +${diff.added.length} added, -${diff.removed.length} removed, ` +
      `${diff.unchanged.length} unchanged`,
  );

  if (pages.length > threshold) {
    console.log(
      `\nLarge scope (> ${threshold}). Review by group (first path segment):`,
    );
    for (const group of groupByPathSegment(pages)) {
      console.log(`  [${group.segment}] ${group.pages.length} page(s)`);
      for (const page of group.pages) console.log(`      ${page}`);
    }
  } else {
    console.log("\nPages:");
    for (const page of pages) console.log(`  ${page}`);
  }

  try {
    const written = approveScope(domain, pages, reviewer);
    console.log(`\nAPPROVED SCOPE: ${pages.length} page(s) -> ${written}`);
    console.log(`reviewer=${reviewer} domain=${domain}`);
  } catch (err) {
    if (err instanceof ScopeApprovalError) {
      console.error("SCOPE APPROVAL REJECTED: " + err.message);
      process.exit(3);
    }
    throw err;
  }
}

const [, , cmd, ...rest] = process.argv;
const args = parseArgs(rest);

switch (cmd) {
  case "list-pending":
    listPending();
    break;
  case "approve":
    approve(args);
    break;
  case "approve-scope": {
    // First positional (non-flag) token is the domain.
    const domain = rest.find((a) => !a.startsWith("--"));
    approveScopeCmd(domain, args);
    break;
  }
  case "run":
    console.log("Use scripts/run-guardian.mjs for the full orchestrated run (Phase 12).");
    break;
  case "report":
    console.log("Report is generated by the orchestrated run (Phase 13).");
    break;
  default:
    console.log("Commands: run | approve | approve-scope | list-pending | report");
}
