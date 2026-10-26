import { writeFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { computeAnalytics, type Analytics } from "../core/analytics.js";
import { buildDashboardData } from "./dashboard-data.js";

/**
 * Phase 5 dashboard builder. Upgrades (does not replace) the static dashboard
 * with an Executive view and an Operational view driven by deterministic
 * historical analytics. Local, database-free. Evidence links use lazy loading.
 * AI-generated content stays visually distinct from deterministic evidence.
 */
function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(1, ...values);
  const bars = "▁▂▃▄▅▆▇█";
  return values.map((v) => bars[Math.min(bars.length - 1, Math.round((v / max) * (bars.length - 1)))]).join("");
}

interface RunFinding { page: string; slug: string; outcomes?: { kind: string; classification: string; detail: string }[]; aiItems?: { agent: string; label: string; text: string; classification: string }[] }

function loadRunFindings(runDir: string): { pages: RunFinding[] } | null {
  const p = join(runDir, "findings.json");
  if (!existsSync(p)) return null;
  try {
    const d = JSON.parse(readFileSync(p, "utf8"));
    return { pages: d.pages ?? [] };
  } catch { return null; }
}

const STYLE = `
body{font-family:system-ui,Segoe UI,Arial,sans-serif;margin:0;background:#f7f8fa;color:#1a202c}
header{background:#1a365d;color:#fff;padding:16px 24px}
h1{margin:0;font-size:20px} h2{font-size:16px;margin:16px 0 8px}
main{padding:24px;max-width:1280px;margin:0 auto}
.tabs{display:flex;gap:8px;margin-bottom:16px}
.tabs button{padding:8px 16px;border:1px solid #cbd5e0;background:#fff;border-radius:6px;cursor:pointer}
.tabs button.active{background:#1a365d;color:#fff}
.view{display:none}.view.active{display:block}
.kpi{display:inline-block;min-width:150px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:6px;vertical-align:top}
.kpi .n{font-size:26px;font-weight:700}.kpi .l{font-size:12px;color:#718096}
.band{border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid #e2e8f0;background:#fff}
.det{border-left:6px solid #2b6cb0}.ai{border-left:6px solid #c05621;background:#fffaf5}
.tag{color:#fff;font-size:11px;padding:2px 8px;border-radius:10px}.det .tag{background:#2b6cb0}.ai .tag{background:#c05621}
.spark{font-family:monospace;font-size:18px;letter-spacing:2px;color:#2b6cb0}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #edf2f7;padding:6px 8px;text-align:left;font-size:13px}
.fail{color:#c53030;font-weight:600}.visual{color:#6b46c1}.ok{color:#2f855a}
.filters{margin:8px 0}.filters input,.filters select{padding:6px;margin-right:8px;border:1px solid #cbd5e0;border-radius:4px}
.disclaimer{font-size:12px;color:#718096}
a{color:#2b6cb0}
`;

const SCRIPT = `
function showView(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active'));document.getElementById(id).classList.add('active');document.getElementById('btn-'+id).classList.add('active');}
function filterRows(){var sev=document.getElementById('f-sev').value;var typ=document.getElementById('f-type').value;var pg=document.getElementById('f-page').value.toLowerCase();document.querySelectorAll('#ops-table tbody tr').forEach(function(tr){var okSev=!sev||tr.dataset.sev===sev;var okTyp=!typ||tr.dataset.type===typ;var okPg=!pg||tr.dataset.page.toLowerCase().indexOf(pg)>=0;tr.style.display=(okSev&&okTyp&&okPg)?'':'none';});}
`;

export function buildDashboard(outPath = "artifacts/dashboard.html"): string {
  const analytics: Analytics = computeAnalytics();
  const runsRoot = resolve("artifacts/runs");
  const runDirs = existsSync(runsRoot)
    ? readdirSync(runsRoot).filter((n) => statSync(join(runsRoot, n)).isDirectory())
        .sort((a, b) => statSync(join(runsRoot, b)).mtimeMs - statSync(join(runsRoot, a)).mtimeMs)
    : [];
  const latestDir = runDirs[0] ? join(runsRoot, runDirs[0]) : null;
  const latest = latestDir ? loadRunFindings(latestDir) : null;

  const last7 = analytics.runs.slice(-7);
  const last30 = analytics.runs.slice(-30);
  const failTrend7 = last7.map((r) => r.failedChecks);
  const failTrend30 = last30.map((r) => r.failedChecks);

  const lc = analytics.findingLifecycle;
  const execKpis = [
    ["Overall status", analytics.deterministicFailuresLatest > 0 ? "ATTENTION" : "HEALTHY"],
    ["Approved pages checked", analytics.pagesCheckedLatest],
    ["Deterministic failures (latest)", analytics.deterministicFailuresLatest],
    ["Total runs", analytics.totalRuns],
    ["New findings", lc.new],
    ["Recurring findings", lc.recurring],
    ["Resolved findings", lc.resolved],
    ["Reopened findings", lc.reopened],
  ].map(([l, n]) => `<div class="kpi"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join("");

  const sevRows = Object.entries(analytics.a11yBySeverity)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");

  // Operational table across latest run.
  let opsRows = "";
  if (latest) {
    for (const p of latest.pages) {
      for (const o of p.outcomes ?? []) {
        const sev = /critical/.test(o.detail) ? "critical" : /serious|a11y/.test(o.detail) ? "serious" : "info";
        opsRows += `<tr data-page="${esc(p.slug)}" data-type="${esc(o.kind)}" data-sev="${esc(sev)}">
          <td>${esc(p.slug)}</td><td class="${o.kind === "failed-check" ? "fail" : o.kind === "visual-finding" ? "visual" : ""}">${esc(o.kind)}</td>
          <td>${esc(o.classification)}</td><td>${esc(o.detail)}</td></tr>`;
      }
    }
  }

  // Run-relative evidence link (publishable): the dashboard lives at
  // artifacts/dashboard.html, so the latest run report is runs/<id>/report/.
  const latestRunDirName = runDirs[0];
  const evidenceLink = latestRunDirName
    ? `<p>Latest run evidence: <a href="runs/${esc(latestRunDirName)}/report/index.html" loading="lazy">open run report</a></p>`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Assurity Web Guardian — Dashboard</title><style>${STYLE}</style></head>
<body>
<header><h1>Assurity Web Guardian — Dashboard</h1><div>Generated ${esc(new Date().toISOString())} · ${esc(analytics.totalRuns)} run(s)</div></header>
<main>
<div class="tabs"><button id="btn-exec" class="active" onclick="showView('exec')">Executive</button><button id="btn-ops" onclick="showView('ops')">Operational</button></div>

<div id="exec" class="view active">
  <div>${execKpis}</div>
  <div class="band det"><span class="tag">Deterministic trends</span>
    <h2>Deterministic failures — last 7 runs</h2><div class="spark">${esc(sparkline(failTrend7))}</div>
    <h2>Deterministic failures — last 30 runs</h2><div class="spark">${esc(sparkline(failTrend30))}</div>
  </div>
  <div class="band det"><span class="tag">Accessibility by severity</span>
    <table><thead><tr><th>Severity</th><th>Tracked findings</th></tr></thead><tbody>${sevRows}</tbody></table>
    <p class="disclaimer">Automated WCAG 2.2 AA checks do not establish full conformance; manual accessibility testing remains necessary.</p>
  </div>
  <div class="band"><h2>Finding lifecycle</h2>
    <p>new=${lc.new} · recurring=${lc.recurring} · resolved=${lc.resolved} · reopened=${lc.reopened} · dismissed-reappeared=${lc.dismissedReappeared}</p>
  </div>
  ${evidenceLink}
</div>

<div id="ops" class="view">
  <div class="filters">
    <input id="f-page" placeholder="filter page..." oninput="filterRows()"/>
    <select id="f-type" onchange="filterRows()"><option value="">all types</option><option>failed-check</option><option>observed-website-change</option><option>visual-finding</option></select>
    <select id="f-sev" onchange="filterRows()"><option value="">all severities</option><option value="critical">critical</option><option value="serious">serious</option><option value="info">info</option></select>
  </div>
  <div class="band det"><span class="tag">Deterministic evidence</span>
    <table id="ops-table"><thead><tr><th>Page</th><th>Outcome</th><th>Classification</th><th>Detail</th></tr></thead><tbody>${opsRows || "<tr><td colspan=4>No findings in latest run.</td></tr>"}</tbody></table>
  </div>
  <p class="disclaimer">AI-generated analysis and agent recommendations appear in the per-run report, visually separated and never presented as measured fact.</p>
</div>
</main>
<script>${SCRIPT}</script>
</body></html>`;

  writeFileSync(resolve(outPath), html, "utf8");

  // Additionally emit the machine-readable DashboardData contract that the new
  // static dashboard (tasks 4.4–4.6) renders from. Written alongside the HTML.
  // Contains only run-relative references — never absolute filesystem paths.
  const dataPath = resolve(outPath, "..", "dashboard-data.json");
  writeFileSync(dataPath, JSON.stringify(buildDashboardData(), null, 2), "utf8");

  return resolve(outPath);
}

