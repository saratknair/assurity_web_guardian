import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { AppendOnlyLog } from "../telemetry/audit-log.js";
import { ApprovalGate } from "../approval/approval-gate.js";
import { newReviewId } from "../core/ids.js";

/**
 * Local human-review interface (Phase 6, Req 6-series). LOOPBACK ONLY
 * (127.0.0.1) — never exposed to the public internet. Shows each review item
 * with its evidence, AI analysis, recommendations, and history. Decisions are
 * submitted through the existing Approval_Gate, which writes Human_Decision +
 * audit records. No agent may invoke review actions. The CLI remains a fallback.
 */
const PORT = 7777;
const HOST = "127.0.0.1";
const RUNS = "artifacts/runs";
const AUDIT = "artifacts/audit.jsonl";

function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function latestRunDir(): string | null {
  const root = resolve(RUNS);
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root).filter((n) => statSync(join(root, n)).isDirectory())
    .sort((a, b) => statSync(join(root, b)).mtimeMs - statSync(join(root, a)).mtimeMs);
  return dirs[0] ? join(root, dirs[0]) : null;
}

interface ReviewItem { findingId: string; page: string; slug: string; kind: string; classification: string; detail: string; ai: { agent: string; text: string }[] }

function reviewItems(): ReviewItem[] {
  const dir = latestRunDir();
  if (!dir) return [];
  const f = join(dir, "findings.json");
  if (!existsSync(f)) return [];
  const data = JSON.parse(readFileSync(f, "utf8"));
  const items: ReviewItem[] = [];
  for (const p of data.pages ?? []) {
    for (const o of p.outcomes ?? []) {
      const ai = (p.aiItems ?? []).filter((a: { relatedFindingId: string }) => a.relatedFindingId === o.findingId)
        .map((a: { agent: string; text: string }) => ({ agent: a.agent, text: a.text }));
      items.push({ findingId: o.findingId, page: p.page, slug: p.slug, kind: o.kind, classification: o.classification, detail: o.detail, ai });
    }
  }
  return items;
}

function page(): string {
  const items = reviewItems();
  const rows = items.map((it) => `
    <div class="band">
      <div><span class="tag det">${esc(it.classification)}</span> <strong>${esc(it.kind)}</strong> — ${esc(it.page)}</div>
      <div class="detail">${esc(it.detail)}</div>
      ${it.ai.map((a) => `<div class="ai"><span class="tag aitag">AI — not fact</span> ${esc(a.agent)}: ${esc(a.text)}</div>`).join("")}
      <form class="decide" data-finding="${esc(it.findingId)}">
        <input name="reviewer" placeholder="your name" required/>
        <select name="decision"><option>accepted</option><option>rejected</option><option>dismissed</option></select>
        <input name="reason" placeholder="reason" required/>
        <button type="submit">Submit decision</button>
      </form>
    </div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Guardian Review</title>
<style>body{font-family:system-ui;margin:0;background:#f7f8fa}header{background:#1a365d;color:#fff;padding:16px}main{max-width:1000px;margin:0 auto;padding:24px}
.band{background:#fff;border:1px solid #e2e8f0;border-left:6px solid #2b6cb0;border-radius:8px;padding:12px;margin-bottom:14px}
.ai{background:#fffaf5;border-left:4px solid #c05621;padding:6px;margin:6px 0}
.tag{color:#fff;font-size:11px;padding:2px 8px;border-radius:10px}.det{background:#2b6cb0}.aitag{background:#c05621}
.detail{margin:6px 0;color:#1a202c}form{margin-top:8px}input,select{padding:6px;margin-right:6px;border:1px solid #cbd5e0;border-radius:4px}
button{padding:6px 12px;background:#2b6cb0;color:#fff;border:0;border-radius:4px;cursor:pointer}.note{color:#718096;font-size:12px}</style></head>
<body><header><h1>Guardian Human Review (local only)</h1><div class="note">127.0.0.1 — not exposed to the internet. Decisions go through the governed Approval_Gate.</div></header>
<main>${rows || "<p>No review items in the latest run.</p>"}</main>
<script>
document.querySelectorAll('form.decide').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();var fd=new FormData(f);
fetch('/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({findingId:f.dataset.finding,reviewer:fd.get('reviewer'),decision:fd.get('decision'),reason:fd.get('reason')})})
.then(r=>r.json()).then(d=>{f.innerHTML='<span class="note">Recorded reviewId '+d.reviewId+' ('+d.decision+')</span>';});});});
</script></body></html>`;
}

const audit = new AppendOnlyLog(resolve(AUDIT));
const gate = new ApprovalGate(audit);

const server = createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(page());
    return;
  }
  if (req.method === "POST" && req.url === "/decide") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const d = JSON.parse(body) as { findingId: string; reviewer: string; decision: string; reason: string };
        // Governed: dispose the finding through the Approval_Gate (human only).
        const reviewId = gate.disposeFinding({
          reviewer: d.reviewer, decision: d.decision as "accepted" | "rejected" | "dismissed",
          reason: d.reason, slug: "", findingId: d.findingId,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reviewId, decision: d.decision }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, HOST, () => {
  console.log(`Guardian review server (local only) at http://${HOST}:${PORT}`);
});
