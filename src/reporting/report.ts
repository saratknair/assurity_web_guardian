import { writeFileSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import type { Outcome, DeterministicCheck } from "../agents/comparator.js";
import type { AiItem } from "../agents/ai-agents.js";
import type { VisualResult } from "../agents/visual-compare.js";

/**
 * Reporting (Req 9, 21, 26). Multi-page consolidated HTML report + static
 * dashboard with an Executive view and an Operational view. Deterministic
 * evidence is visually distinct from AI-generated analysis (never shown as fact).
 */
export interface PageReport {
  page: string;
  slug: string;
  baselineVersion: string;
  checks: DeterministicCheck[];
  outcomes: Outcome[];
  aiItems: AiItem[];
  visual: Record<string, VisualResult>;
  evidence: { kind: string; path: string }[];
}

export interface ReportModel {
  runId: string;
  correlationId: string;
  generatedAt: string;
  pages: PageReport[];
  agentStatuses: { agent: string; status: string }[];
  websiteHealth: "healthy" | "attention" | "failing";
  totalFailedChecks: number;
  pendingReview: boolean;
}

function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const STYLE = `
body{font-family:system-ui,Segoe UI,Arial,sans-serif;margin:0;background:#f7f8fa;color:#1a202c}
header{background:#1a365d;color:#fff;padding:16px 24px}
h1{margin:0;font-size:20px} h2{font-size:16px}
.meta{color:#cbd5e0;font-size:13px;margin-top:4px}
main{padding:24px;max-width:1200px;margin:0 auto}
.tabs{display:flex;gap:8px;margin-bottom:16px}
.tabs button{padding:8px 16px;border:1px solid #cbd5e0;background:#fff;border-radius:6px;cursor:pointer;font-size:14px}
.tabs button.active{background:#1a365d;color:#fff;border-color:#1a365d}
.view{display:none} .view.active{display:block}
.band{border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid #e2e8f0;background:#fff}
.det{border-left:6px solid #2b6cb0} .ai{border-left:6px solid #c05621;background:#fffaf5}
.ai .tag{background:#c05621} .det .tag{background:#2b6cb0}
.tag{color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:.04em}
.item{padding:8px 10px;border-bottom:1px solid #edf2f7;font-size:14px}
.fail{color:#c53030;font-weight:600} .change{color:#b7791f;font-weight:600} .visual{color:#6b46c1;font-weight:600} .ok{color:#2f855a}
.health{display:inline-block;padding:4px 12px;border-radius:12px;font-weight:600}
.healthy{background:#c6f6d5;color:#22543d} .attention{background:#feebc8;color:#7b341e} .failing{background:#fed7d7;color:#742a2a}
.kpi{display:inline-block;min-width:150px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:6px}
.kpi .n{font-size:24px;font-weight:700} .kpi .l{font-size:12px;color:#718096}
.agents span{display:inline-block;background:#edf2f7;border-radius:10px;padding:3px 10px;margin:2px;font-size:12px}
.disclaimer{font-size:12px;color:#718096;margin-top:4px}
details{margin:6px 0} summary{cursor:pointer;font-weight:600}
a{color:#2b6cb0}
`;

const SCRIPT = `
function showView(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active'));document.getElementById(id).classList.add('active');document.getElementById('btn-'+id).classList.add('active');}
`;

/**
 * Convert an evidence path into a link relative to the report directory
 * (`<runDir>/report`). Absolute filesystem paths are made run-relative so the
 * per-run report is publishable and leaks no absolute path (Req 11.8); paths
 * that are already relative are passed through with normalized separators.
 */
function evidenceHref(absOrRel: string, reportDir?: string): string {
  let rel = absOrRel;
  if (reportDir && isAbsolute(absOrRel)) {
    rel = relative(reportDir, absOrRel);
  }
  return rel.replace(/\\/g, "/");
}

function pageOps(p: PageReport, reportDir?: string): string {
  const checks = p.checks.map((c) =>
    `<div class="item"><span class="${c.passed ? "ok" : "fail"}">${c.passed ? "PASS" : "FAIL"}</span> ${esc(c.name)} — ${esc(c.detail)}</div>`).join("");
  const outcomes = p.outcomes.map((o) => {
    const cls = o.kind === "failed-check" ? "fail" : o.kind === "visual-finding" ? "visual" : "change";
    return `<div class="item"><span class="${cls}">${esc(o.kind)}</span> ${esc(o.detail)} <small>(${esc(o.classification)}, findingId=${esc(o.findingId)})</small></div>`;
  }).join("");
  const ai = p.aiItems.map((a) =>
    `<div class="item"><span class="tag">${esc(a.label)}</span> <strong>${esc(a.agent)}</strong> — ${esc(a.text)} <small>(relatedFindingId=${esc(a.relatedFindingId)})</small></div>`).join("");
  const visual = Object.entries(p.visual).map(([vp, v]) =>
    `<div class="item">${esc(vp)}: ${v.differs ? '<span class="visual">visual difference</span>' : '<span class="ok">no visual difference</span>'} — ${esc(v.note)}</div>`).join("");
  const evidence = p.evidence.map((e) =>
    `<li>${esc(e.kind)}: <a href="${esc(evidenceHref(e.path, reportDir))}" loading="lazy">${esc(e.path.split(/[\\/]/).pop() || e.path)}</a></li>`).join("");
  return `<details><summary>${esc(p.page)} — baseline ${esc(p.baselineVersion)}</summary>
    <div class="band det"><span class="tag">Deterministic</span><h2>Checks</h2>${checks}
      <h2>Outcomes</h2>${outcomes || "<div class='item'>none</div>"}
      <h2>Visual comparison</h2>${visual || "<div class='item'>none</div>"}</div>
    <div class="band ai"><span class="tag">AI-generated — not a deterministic fact</span><h2>AI analysis & recommendations</h2>${ai || "<div class='item'>none</div>"}</div>
    <div class="band"><h2>Evidence</h2><ul>${evidence}</ul></div>
  </details>`;
}

export function renderReportHtml(m: ReportModel, reportDir?: string): string {
  const totalOutcomes = m.pages.reduce((s, p) => s + p.outcomes.length, 0);
  const visualChanges = m.pages.reduce((s, p) => s + Object.values(p.visual).filter((v) => v.differs).length, 0);
  const a11yFindings = m.pages.reduce((s, p) => s + p.outcomes.filter((o) => /a11y/.test(o.detail)).length, 0);

  const execKpis = [
    ["Pages checked", m.pages.length],
    ["Deterministic failures", m.totalFailedChecks],
    ["Accessibility findings", a11yFindings],
    ["Visual changes", visualChanges],
    ["Total findings", totalOutcomes],
    ["Pending review", m.pendingReview ? "yes" : "no"],
  ].map(([l, n]) => `<div class="kpi"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join("");

  const baselineList = m.pages.map((p) => `<div class="item">${esc(p.slug)} — baseline ${esc(p.baselineVersion)}</div>`).join("");
  const ops = m.pages.map((p) => pageOps(p, reportDir)).join("");
  const agents = m.agentStatuses.map((s) => `<span>${esc(s.agent)}: ${esc(s.status)}</span>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Assurity Web Guardian — Run ${esc(m.runId)}</title><style>${STYLE}</style></head>
<body>
<header><h1>Assurity Web Guardian</h1><div class="meta">Run ${esc(m.runId)} · correlationId ${esc(m.correlationId)} · ${esc(m.generatedAt)}</div></header>
<main>
<div class="tabs"><button id="btn-exec" class="active" onclick="showView('exec')">Executive</button><button id="btn-ops" onclick="showView('ops')">Operational</button></div>

<div id="exec" class="view active">
  <p>Overall website quality: <span class="health ${m.websiteHealth}">${m.websiteHealth.toUpperCase()}</span></p>
  <div>${execKpis}</div>
  <div class="band"><h2>Approved baseline versions</h2>${baselineList}</div>
  <div class="band"><h2>Summary</h2><p>${m.totalFailedChecks > 0
    ? `${m.totalFailedChecks} deterministic check(s) failed across ${m.pages.length} approved page(s) and require human review. Accessibility issues were found; automated checks do not establish full WCAG conformance.`
    : `All deterministic checks passed across ${m.pages.length} approved page(s).`}</p></div>
</div>

<div id="ops" class="view">
  <div class="band"><h2>Agent activity (truthful status)</h2><div class="agents">${agents}</div></div>
  <h2>Page-by-page</h2>
  ${ops}
  <p class="disclaimer">Automated WCAG 2.2 AA checks do not establish full conformance; manual accessibility testing remains necessary. AI-generated items are interpretations, never measured facts.</p>
</div>
</main>
<script>${SCRIPT}</script>
</body></html>`;
}

export function writeReport(runDir: string, m: ReportModel): string {
  const reportDir = join(runDir, "report");
  const p = join(reportDir, "index.html");
  // Evidence links are rendered relative to the report directory so the
  // per-run report is publishable and contains no absolute file:/// paths.
  writeFileSync(p, renderReportHtml(m, reportDir), "utf8");
  return p;
}

export function writeDashboard(dashboardPath: string, m: ReportModel): string {
  writeFileSync(dashboardPath, renderReportHtml(m), "utf8");
  return dashboardPath;
}

