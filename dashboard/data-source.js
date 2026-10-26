// Assurity Web Guardian — dashboard data source resolver (task 4.5).
//
// Plain browser ES module (NO TypeScript, NO build step). The dashboard/ app is
// static HTML + JS + CSS served same-origin. This module decides WHERE the
// dashboard's `DashboardData` comes from and returns a small resolved handle:
//
//   { mode: "static" | "live", load: async () => DashboardData }
//
// Resolution order (design.md → Dashboard data source; Req 1.5, 1.6, 6.10):
//
//   1. BUILD / DEPLOY FLAG FIRST. The page may set a global `window.AWG_MODE`
//      (the GitHub Pages deploy injects `window.AWG_MODE = "static"` via a
//      generated config <script>; locally it may be "live" or unset). The
//      design calls the Pages value "replay"/"static" interchangeably for the
//      dashboard, so we accept "static" or "replay" as static, and "live" as
//      live. The flag ALWAYS wins over the probe.
//
//   2. PROBE FALLBACK (only when the flag is absent). Probe the local read-only
//      Event_Server at GET http://127.0.0.1:7788/idle with a short timeout
//      (1500 ms, AbortController). A response → live; error/timeout → static.
//
// CRITICAL no-network guarantee (Req 1.5): in STATIC mode, NO request to
// 127.0.0.1 or any absolute URL is ever issued. The probe runs ONLY when the
// flag is absent — the moment `window.AWG_MODE` is "static"/"replay" we skip the
// probe entirely and the only network call the module ever makes is the
// RELATIVE, same-origin `./data/dashboard.json` fetch inside the static loader.
//
// The LIVE loader is the only code path allowed to touch 127.0.0.1:7788, and it
// is only reachable when the flag says "live" or the probe succeeded.

/** Loopback base for the local read-only Event_Server (live mode only). */
const EVENT_SERVER = "http://127.0.0.1:7788";

/** Relative, same-origin published data (static mode only). */
const STATIC_DATA_URL = "./data/dashboard.json";

/** Probe timeout for the /idle fallback, in milliseconds. */
const PROBE_TIMEOUT_MS = 1500;

/** Canonical a11y severity buckets, in presentation order (mirror of the TS). */
const SEVERITY_BUCKETS = ["critical", "serious", "moderate", "minor"];

/**
 * Read the injected build/deploy flag, if any.
 *
 * Returns "static" | "live" | null. We read `window.AWG_MODE` (what the Pages
 * deploy / local config sets). "static" and "replay" both mean static for the
 * dashboard; "live" means live. Anything else (undefined, "", unknown) → null,
 * which triggers the probe fallback.
 *
 * @returns {"static"|"live"|null}
 */
export function readModeFlag() {
  const raw =
    typeof window !== "undefined" && window.AWG_MODE != null
      ? String(window.AWG_MODE).trim().toLowerCase()
      : "";
  if (raw === "static" || raw === "replay") return "static";
  if (raw === "live") return "live";
  return null;
}

/**
 * Probe the local Event_Server's /idle endpoint with a short timeout.
 *
 * ONLY called when the build flag is absent. A successful (non-network-error)
 * response means a local server is up → live mode. Any error, non-OK status, or
 * timeout → static mode (fail safe to the no-network static path).
 *
 * @returns {Promise<boolean>} true if the local server responded, else false.
 */
export async function probeEventServer() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${EVENT_SERVER}/idle`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    return res.ok;
  } catch {
    // Network error / abort / timeout / CORS failure → treat as "no server".
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the dashboard data source.
 *
 * Flag first, probe only when the flag is absent. Returns a handle whose
 * `load()` fetches and returns a `DashboardData`-shaped object. The resolver
 * itself never fetches application data — it only (optionally) probes /idle
 * when no flag is set, and never probes when the flag selects static.
 *
 * @returns {Promise<{ mode: "static"|"live", load: () => Promise<object> }>}
 */
export async function resolveDataSource() {
  const flag = readModeFlag();

  if (flag === "static") {
    // Explicit static: DO NOT probe. Never touch 127.0.0.1 / any absolute URL.
    return { mode: "static", load: loadStatic };
  }
  if (flag === "live") {
    return { mode: "live", load: loadLive };
  }

  // No explicit flag → probe the local server once. Success → live, else static.
  const serverUp = await probeEventServer();
  return serverUp
    ? { mode: "live", load: loadLive }
    : { mode: "static", load: loadStatic };
}

// ---------------------------------------------------------------------------
// STATIC loader — relative, same-origin fetch ONLY. No absolute/127.0.0.1 URL.
// ---------------------------------------------------------------------------

/**
 * Load `DashboardData` from the published static JSON.
 *
 * Issues exactly one request, to the RELATIVE same-origin URL
 * `./data/dashboard.json`. No other requests are made. This is the only network
 * activity permitted in static mode (Req 1.5).
 *
 * @returns {Promise<object>} the parsed DashboardData.
 */
export async function loadStatic() {
  const res = await fetch(STATIC_DATA_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`static dashboard data fetch failed: HTTP ${res.status}`);
  }
  return /** @type {object} */ (await res.json());
}

// ---------------------------------------------------------------------------
// LIVE loader — assembles DashboardData from the local Event_Server (:7788).
// Only reachable when the flag is "live" or the /idle probe succeeded.
// Mirrors the field names and pure-helper logic of
// src/reporting/dashboard-data.ts so live and static render the same shape.
// ---------------------------------------------------------------------------

/**
 * Assemble a `DashboardData`-shaped object from the Event_Server endpoints:
 *   GET /runs                   -> [{ runId, mtime }], newest-first
 *   GET /runs/:id/events        -> event objects (JSONL parsed server-side)
 *   GET /runs/:id/findings      -> findings.json (pages[] or legacy single page)
 *
 * Keeps assembly minimal: the latest run drives the page/AI/severity
 * breakdowns; the run list drives the health trend. All field names mirror the
 * TS `DashboardData` contract (runHealthTrend, findingsByPage,
 * findingsBySeverity, a11yNewVsRecurring, aiItems, empty, generatedAt, domain).
 *
 * @returns {Promise<object>} the assembled DashboardData.
 */
export async function loadLive() {
  const runs = await fetchJson(`${EVENT_SERVER}/runs`);
  const runList = Array.isArray(runs) ? runs : [];

  if (runList.length === 0) {
    return emptyDashboardData();
  }

  // The Event_Server returns /runs newest-first; reverse to chronological
  // (oldest→newest) so the trend reads left-to-right like the static builder.
  const chrono = [...runList].reverse();

  // Build the health trend from each run's events (finishedAt + health, with a
  // failedChecks fallback derived from the run's findings when events lack it).
  const trendPoints = await Promise.all(
    chrono.map((r) => runHealthPoint(String(r.runId))),
  );
  const runHealthTrend = trendPoints.filter(Boolean);

  // Latest run drives the page/severity/AI breakdowns.
  const latestRunId = String(chrono[chrono.length - 1].runId);
  const findings = await fetchJson(`${EVENT_SERVER}/runs/${encodeURIComponent(latestRunId)}/findings`);
  const pages = pagesFromFindings(findings);

  const findingsByPage = buildFindingsByPage(pages);
  const findingsBySeverity = buildFindingsBySeverity(pages);
  const aiItems = collectAiItems(pages);
  const a11yNewVsRecurring = await newVsRecurringFromEvents(latestRunId);

  return {
    generatedAt: new Date().toISOString(),
    domain: deriveDomain(pages),
    runHealthTrend,
    findingsByPage,
    findingsBySeverity,
    a11yNewVsRecurring,
    aiItems,
    empty: false,
  };
}

/** A DashboardData with no runs (live source reports zero runs → empty state). */
function emptyDashboardData() {
  return {
    generatedAt: new Date().toISOString(),
    domain: "",
    runHealthTrend: [],
    findingsByPage: [],
    findingsBySeverity: { critical: 0, serious: 0, moderate: 0, minor: 0 },
    a11yNewVsRecurring: { new: 0, recurring: 0 },
    aiItems: [],
    empty: true,
  };
}

/**
 * Build one RunHealthPoint for a run by reading its events (and findings as a
 * fallback for failedChecks). Mirrors runPointFromEvents() in the TS builder.
 *
 * @param {string} runId
 * @returns {Promise<{runId:string, finishedAt?:string, failedChecks:number, health:string}>}
 */
async function runHealthPoint(runId) {
  const events = await fetchJson(`${EVENT_SERVER}/runs/${encodeURIComponent(runId)}/events`).catch(() => []);
  const evts = Array.isArray(events) ? events : [];

  let finishedAt;
  let health;
  for (const ev of evts) {
    const kind = ev && ev.kind;
    const data = (ev && ev.data) || {};
    if (kind === "run.record" && typeof data.finishedAt === "string") {
      finishedAt = data.finishedAt;
    }
    if (kind === "run.finished" && typeof data.health === "string") {
      health = data.health;
    }
  }

  // failedChecks: prefer an explicit run.finished count, else count failed-check
  // outcomes from the run's findings (same signal the TS builder uses).
  let failedChecks = 0;
  const finishedEvent = evts.find((e) => e && e.kind === "run.finished" && e.data);
  if (finishedEvent && typeof finishedEvent.data.failedChecks === "number") {
    failedChecks = finishedEvent.data.failedChecks;
  } else {
    const findings = await fetchJson(`${EVENT_SERVER}/runs/${encodeURIComponent(runId)}/findings`).catch(() => null);
    failedChecks = countFailedChecks(pagesFromFindings(findings));
  }

  if (!health) health = failedChecks > 0 ? "attention" : "healthy";
  return { runId, finishedAt, failedChecks, health };
}

/** Count failed-check outcomes across pages (failedChecks fallback). */
function countFailedChecks(pages) {
  let n = 0;
  for (const p of pages) {
    for (const o of p.outcomes || []) {
      if (o && o.kind === "failed-check") n++;
    }
  }
  return n;
}

/**
 * Derive new-vs-recurring from a run's events when present; otherwise zeros.
 * The static builder sources this from the a11y history (not exposed per-run by
 * the Event_Server), so live mode reads it from a lifecycle event if emitted.
 *
 * @param {string} runId
 * @returns {Promise<{new:number, recurring:number}>}
 */
async function newVsRecurringFromEvents(runId) {
  const events = await fetchJson(`${EVENT_SERVER}/runs/${encodeURIComponent(runId)}/events`).catch(() => []);
  const evts = Array.isArray(events) ? events : [];
  for (const ev of evts) {
    const data = (ev && ev.data) || {};
    const lc = data.findingLifecycle || data.lifecycle;
    if (lc && (typeof lc.new === "number" || typeof lc.recurring === "number")) {
      return { new: Number(lc.new) || 0, recurring: Number(lc.recurring) || 0 };
    }
  }
  return { new: 0, recurring: 0 };
}

// ---------------------------------------------------------------------------
// Pure assembly helpers — ports of src/reporting/dashboard-data.ts so the live
// shape matches the static one exactly. No network, no absolute paths.
// ---------------------------------------------------------------------------

/** Normalize a run's findings.json into the shared pages[] shape. */
function pagesFromFindings(raw) {
  if (!raw || typeof raw !== "object") return [];
  if (Array.isArray(raw.pages)) return raw.pages;
  // Legacy single-page layout: top-level page/outcomes/aiItems.
  if (raw.outcomes || raw.aiItems) {
    return [{ page: raw.page, outcomes: raw.outcomes, aiItems: raw.aiItems }];
  }
  return [];
}

/** Per-page finding counts (sum conserves the total). */
function buildFindingsByPage(pages) {
  return pages.map((p) => ({
    page: p.page || p.slug || "(unknown)",
    count: (p.outcomes || []).length,
  }));
}

/**
 * Map a failed-check `detail` string to a severity bucket. Axe a11y checks are
 * emitted as e.g. "desktop:a11y-critical-serious: link-name"; we pick the
 * highest-severity token present. Unknown/missing → "minor", so every outcome
 * lands in exactly one bucket (partition total == outcome total).
 */
function severityBucketOf(detail) {
  const text = String(detail || "").toLowerCase();
  for (const bucket of SEVERITY_BUCKETS) {
    if (text.includes(bucket)) return bucket;
  }
  return "minor";
}

/** Severity buckets partition the findings by their detail severity token. */
function buildFindingsBySeverity(pages) {
  const out = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const p of pages) {
    for (const o of p.outcomes || []) {
      out[severityBucketOf(o && o.detail)]++;
    }
  }
  return out;
}

/** Collect AI-assisted items from a run's pages (mirror of the TS helper). */
function collectAiItems(pages) {
  const items = [];
  for (const p of pages) {
    for (const a of p.aiItems || []) {
      items.push({
        agent: a.agent,
        label: a.label,
        text: a.text,
        relatedFindingId: a.relatedFindingId || "",
        classification: a.classification || "ai-generated-analysis",
      });
    }
  }
  return items;
}

/** Best-effort domain from the first page URL's host; "" when unknown. */
function deriveDomain(pages) {
  for (const p of pages) {
    const u = p && p.page;
    if (typeof u === "string" && u) {
      try {
        return new URL(u).host;
      } catch {
        /* not an absolute URL; ignore */
      }
    }
  }
  return "";
}

/**
 * Fetch JSON from an absolute Event_Server URL. LIVE MODE ONLY — never called
 * from the static path. Throws on non-OK responses.
 *
 * @param {string} url absolute http://127.0.0.1:7788/... URL
 * @returns {Promise<any>}
 */
async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`event-server fetch failed: HTTP ${res.status} for ${url}`);
  return res.json();
}
