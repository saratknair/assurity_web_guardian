import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync, watch } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Local read-only event-access layer (Phase 10, Req 10-series). LOOPBACK ONLY.
 * The existing artifacts/runs/<run-id>/events.jsonl files + audit records are
 * the SOURCE OF TRUTH; this never invents a second telemetry model, never
 * modifies evidence, never manufactures progress or agent activity. It reports
 * idle when no workflow is active.
 *
 * Endpoints (all read-only):
 *   GET  /runs                      -> run metadata list
 *   GET  /runs/:id/events           -> historical events for a run
 *   GET  /runs/:id/findings         -> findings metadata for a run
 *   GET  /live                      -> SSE stream of the active run's new events
 *   GET  /replay/:id?speed=N        -> SSE replay of a completed run by timestamp
 *   GET  /idle                      -> { idle: boolean, activeRun?: string }
 */
const PORT = 7788;
const HOST = "127.0.0.1";
const RUNS = resolve("artifacts/runs");
const LOCK = resolve("artifacts/.guardian.lock");

function runDirs(): string[] {
  if (!existsSync(RUNS)) return [];
  return readdirSync(RUNS).filter((n) => statSync(join(RUNS, n)).isDirectory())
    .sort((a, b) => statSync(join(RUNS, b)).mtimeMs - statSync(join(RUNS, a)).mtimeMs);
}

/** Parse complete JSONL lines; ignore a trailing partial (incomplete write). */
function readEvents(id: string): Record<string, unknown>[] {
  const p = join(RUNS, id, "events.jsonl");
  if (!existsSync(p)) return [];
  const text = readFileSync(p, "utf8");
  const lines = text.split("\n");
  const out: Record<string, unknown>[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip incomplete/partial line safely */ }
  }
  return out;
}

function activeRun(): string | null {
  if (!existsSync(LOCK)) return null;
  // Lock present => a run is active. Return the newest run dir as best-effort id.
  return runDirs()[0] ?? "active";
}

function json(res: import("node:http").ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

function sseInit(res: import("node:http").ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" });
    return res.end();
  }

  if (url.pathname === "/idle") {
    const active = activeRun();
    return json(res, 200, { idle: active === null, activeRun: active ?? undefined });
  }
  if (url.pathname === "/runs") {
    return json(res, 200, runDirs().map((id) => ({ runId: id, mtime: statSync(join(RUNS, id)).mtimeMs })));
  }
  if (parts[0] === "runs" && parts[2] === "events") {
    return json(res, 200, readEvents(parts[1]));
  }
  if (parts[0] === "runs" && parts[2] === "findings") {
    const p = join(RUNS, parts[1], "findings.json");
    return json(res, 200, existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {});
  }

  // Live SSE: tails the active run's events.jsonl; emits only genuine new events.
  if (url.pathname === "/live") {
    sseInit(res);
    const active = activeRun();
    if (!active) { res.write(`event: idle\ndata: {"idle":true}\n\n`); return; }
    const file = join(RUNS, active, "events.jsonl");
    let sent = 0;
    const flush = () => {
      const evts = readEvents(active);
      for (let i = sent; i < evts.length; i++) res.write(`data: ${JSON.stringify(evts[i])}\n\n`);
      sent = evts.length; // avoid duplicating completed events on reconnection
    };
    flush();
    let w: ReturnType<typeof watch> | null = null;
    try { if (existsSync(file)) w = watch(file, () => flush()); } catch { /* ignore */ }
    const ka = setInterval(() => res.write(`: keep-alive\n\n`), 15000);
    req.on("close", () => { clearInterval(ka); if (w) w.close(); });
    return;
  }

  // Replay SSE: replays a completed run's events by timestamp, clearly labeled.
  if (parts[0] === "replay" && parts[1]) {
    sseInit(res);
    const speed = Math.max(1, Number(url.searchParams.get("speed") ?? "10"));
    const evts = readEvents(parts[1]);
    res.write(`event: replay-start\ndata: {"runId":"${parts[1]}","mode":"replay"}\n\n`);
    let i = 0;
    const base = evts.length ? new Date(String(evts[0].ts)).getTime() : 0;
    const start = Date.now();
    const tick = setInterval(() => {
      if (i >= evts.length) { res.write(`event: replay-end\ndata: {}\n\n`); clearInterval(tick); res.end(); return; }
      const evtTime = new Date(String(evts[i].ts)).getTime();
      const elapsedVirtual = (Date.now() - start) * speed;
      if (evtTime - base <= elapsedVirtual) {
        res.write(`data: ${JSON.stringify({ ...evts[i], mode: "replay" })}\n\n`);
        i++;
      }
    }, 50);
    req.on("close", () => clearInterval(tick));
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Guardian event-access (read-only, local only) at http://${HOST}:${PORT}`);
});
