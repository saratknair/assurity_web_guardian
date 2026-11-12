import { chromium } from "@playwright/test";
import AxeBuilderModule from "@axe-core/playwright";
const AxeBuilder = ((AxeBuilderModule as unknown as { default?: unknown }).default ?? AxeBuilderModule) as unknown as (new (opts: { page: unknown }) => { withTags(tags: string[]): { analyze(): Promise<{ violations: { id: string; impact: string | null; help?: string; helpUrl?: string; nodes?: { target?: string[] }[] }[] }> } });
import { resolve, join } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { effectiveEntries, serializeLog } from "./dispositions.js";
import { readLog, logPath } from "./disposition-store.js";
import { resolveApprovedUrls, type AppConfig } from "../config/app-config.js";
import { newRunIds } from "./ids.js";
import { EvidenceStore, applyRetention } from "./evidence-store.js";
import { FileExporter } from "../telemetry/exporters/file-exporter.js";
import { AppendOnlyLog } from "../telemetry/audit-log.js";
import { TelemetryEmitter } from "../telemetry/telemetry-emitter.js";
import { SiteGateway } from "./site-gateway.js";
import { compare, type DeterministicCheck, type Outcome } from "../agents/comparator.js";
import { qualityAnalysis, visualExplanation, triageRecommendation, type AiItem } from "../agents/ai-agents.js";
import { latestBaselineVersion, generateTestFromBaseline, writeTestManifest, type GeneratedTest } from "../agents/test-generator.js";
import { slugify } from "../agents/spec-generator.js";
import { takeScreenshot } from "../agents/screenshot.js";
import { compareScreenshot, type VisualResult } from "../agents/visual-compare.js";
import { writeReport, writeDashboard, type ReportModel, type PageReport } from "../reporting/report.js";
import { buildDashboard } from "../reporting/dashboard-builder.js";
import { recordStep, summariseStep, createStepSeq } from "../telemetry/step-recorder.js";
import { LocalOtelExporter } from "../telemetry/otel-adapter.js";
import { computeLifecycleForRun } from "./run-lifecycle.js";
import { publish } from "../publish/publisher.js";
import { runOriginMarker } from "../publish/published-data.js";

/**
 * Build the run-source marker from env. Only strictly validated short tokens are
 * kept (numeric run id, 40-hex sha, [a-z_] event/trigger names); the rest is omitted.
 * Returns null when nothing validates (e.g. outside CI).
 */
export function buildRunSource(env: Record<string, string | undefined>): Record<string, string> | null {
  const out: Record<string, string> = {};
  const trigger = (env.AWG_RUN_TRIGGER ?? "").trim();
  if (/^[a-z_]{1,32}$/.test(trigger)) out.trigger = trigger;
  const runId = (env.AWG_GH_RUN_ID ?? "").trim();
  if (/^[0-9]{1,20}$/.test(runId)) out.githubRunId = runId;
  const sha = (env.AWG_GH_SHA ?? "").trim();
  if (/^[0-9a-f]{40}$/.test(sha)) out.sha = sha;
  const event = (env.AWG_GH_EVENT_NAME ?? "").trim();
  if (/^[a-z_]{1,32}$/.test(event)) out.eventName = event;
  const hasGh = out.githubRunId !== undefined || out.sha !== undefined || out.eventName !== undefined;
  return hasGh ? out : null;
}

/** Write `run-source.json` into the run dir when there is something valid to record. Never throws. */
export function writeRunSourceMarker(runDir: string, env: Record<string, string | undefined>): boolean {
  try {
    const src = buildRunSource(env);
    if (!src) return false;
    writeFileSync(join(runDir, "run-source.json"), JSON.stringify(src, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Write `dispositions-applied.json` into the run directory (design I.6).
 * Status is `unavailable` (no entries) when the CI restore status says so or the log cannot be read.
 * Never throws and never modifies the log.
 */
export function freezeDispositions(
  runDir: string,
  runId: string,
  finishedAt: string,
  artifactsDir: string = resolve("artifacts"),
): { status: "applied" | "unavailable"; entries: ReturnType<typeof effectiveEntries> } {
  let status: "applied" | "unavailable" = "applied";
  let entries: ReturnType<typeof effectiveEntries> = [];
  let digestSource = "";
  try {
    let restore = "";
    try {
      const raw = JSON.parse(readFileSync(join(artifactsDir, "dispositions.status.json"), "utf8")) as { status?: unknown };
      restore = typeof raw.status === "string" ? raw.status : "";
    } catch {
      restore = "";
    }
    const read = readLog(logPath(artifactsDir));
    if (restore === "unavailable" || read.status === "unavailable") {
      status = "unavailable";
    } else {
      digestSource = serializeLog(read.log);
      entries = effectiveEntries(read.log, finishedAt);
    }
  } catch {
    status = "unavailable";
    entries = [];
  }
  const logDigest = createHash("sha256").update(digestSource, "utf8").digest("hex").slice(0, 16);
  const out = { schemaVersion: 1, runId, finishedAt, status, logDigest, entries };
  writeFileSync(join(runDir, "dispositions-applied.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
  return { status, entries };
}

/**
 * Conventional local Pages output directory for the published bundle (Req 6.7).
 * The same tree the CI `run` job assembles in `./_site` is produced locally here
 * so Live_Mode and Replay_Mode publish identically. Kept in one place so the
 * local publisher and other tooling agree on it.
 */
export const LOCAL_PUBLISHED_DIR = "artifacts/published";

/** Persisted (path-free) subset of VisualResult for findings.json pages[].visual. */
export function sanitizeVisual(
  visual: Record<string, VisualResult> | undefined,
): Record<string, {
  differs: boolean;
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  dimensionsChanged: boolean;
  baselineHash: string | null;
  note: string;
}> {
  const out: Record<string, { differs: boolean; diffPixels: number; totalPixels: number; diffRatio: number; dimensionsChanged: boolean; baselineHash: string | null; note: string }> = {};
  for (const [vp, v] of Object.entries(visual ?? {})) {
    out[vp] = {
      differs: v.differs,
      diffPixels: v.diffPixels,
      totalPixels: v.totalPixels,
      diffRatio: v.diffRatio,
      dimensionsChanged: v.dimensionsChanged,
      baselineHash: v.baselineHash,
      note: v.note,
    };
  }
  return out;
}

export interface RunTrigger {
  readonly kind: "manual" | "scheduled";
  start(cfg: AppConfig): Promise<string>;
}

/**
 * Orchestrator (Req 28, 29, 31.4). Coordinates the full multi-page workflow
 * under one correlationId across ALL approved pages, emits truthful agent-status
 * events, and NEVER approves any finding or baseline. Runs deterministic checks
 * live on desktop+mobile, computes visual diffs vs approved screenshot baselines
 * (Phase 2), classifies outcomes, invokes AI agents (labeled), and writes the
 * report + static dashboard. Preserves existing homepage history.
 */
export async function runGuardian(cfg: AppConfig): Promise<string> {
  // Phase 2 (Req 5.7, 12.6): scan the human-approved Full_Site_Scope
  // (`config/scope/<domain>.approved.json`) when present — capped at
  // `maxApprovedPages` — otherwise fall back to the legacy page-seed.json. Only
  // the APPROVED scope is ever scanned (never the proposed one), preserving
  // human-in-control. Conservative pacing is unchanged.
  const scope = resolveApprovedUrls(cfg);
  const approvedUrls = scope.urls;
  const { runId, correlationId } = newRunIds();

  const store = new EvidenceStore(runId);
  const exporter = new FileExporter(store.eventsPath);
  const auditLog = new AppendOnlyLog(store.auditPath);
  // Optional local OpenTelemetry adapter — DISABLED by default. Enable with
  // AWG_OTEL=1 (writes OTel-shaped spans/metrics to local files only; no SDK,
  // no collector, no network). Export failure never stops the Guardian.
  const otelEnabled = process.env.AWG_OTEL === "1";
  const otel = new LocalOtelExporter({ enabled: otelEnabled, outDir: "artifacts/otel" });
  const tel = new TelemetryEmitter(runId, correlationId, exporter, auditLog, otelEnabled ? [otel] : []);
  const gateway = new SiteGateway(cfg);
  const seq = createStepSeq();

  const startedAt = new Date().toISOString();
  tel.event("run.started", { data: { replaySchema: 1, pages: approvedUrls.length, scopeSource: scope.source } });

  // Setup phase (Req 1-4): each run re-reads the human-approved Page_Seed_File
  // and confirms the approved baselines that govern this run. These agents did
  // their primary work at seed/approval time; here they re-validate, so the
  // office shows them active at the start of every run (genuine, not synthetic).
  const approvedCount = approvedUrls.length;
  tel.event("discovery.validated", { data: { approvedCount, scopeSource: scope.source } });

  const allOutcomes: Outcome[] = [];
  const allAiItems: AiItem[] = [];
  const pageReports: PageReport[] = [];
  const generated: GeneratedTest[] = [];
  let totalFailedChecks = 0;
  const scannedPairs: { pageUrl: string; viewport: string }[] = [];

  const browser = await chromium.launch();
  try {
    for (const url of approvedUrls) {
      const slug = slugify(url);
      const version = latestBaselineVersion(slug);
      if (version === null) {
        tel.event("page.skipped", { data: { url, slug, reason: "no approved baseline" } });
        continue;
      }
      // Test generation from the approved baseline (Req 5).
      tel.agentStatus("Test_Generator", "deterministic", "working");
      generated.push(
        await recordStep(
          tel,
          { step: "test-plan", agent: "Test_Generator", pageUrl: url, slug, seq },
          () => generateTestFromBaseline(slug, url),
          () => summariseStep("test-plan", undefined),
        ),
      );
      tel.agentStatus("Test_Generator", "deterministic", "completed");

      const pageChecks: DeterministicCheck[] = [];
      const pageEvidence: { kind: string; path: string }[] = [];
      const visualByViewport: Record<string, VisualResult> = {};

      for (const vp of [
        { name: "desktop" as const, size: cfg.viewports.desktop },
        { name: "mobile" as const, size: cfg.viewports.mobile },
      ]) {
        tel.agentStatus("Observation_Runner", "deterministic", "working", undefined);
        // Conservative pacing between page loads (Req 12.1).
        await new Promise((r) => setTimeout(r, cfg.limits.requestSpacingMs));
        const stepMeta = { agent: "Observation_Runner", pageUrl: url, slug, viewport: vp.name, seq } as const;
        const loaded = await recordStep(
          tel,
          { ...stepMeta, step: "load" },
          async () => {
            const context = await browser.newContext({ viewport: vp.size });
            const page = await context.newPage();
            const consoleErrors: string[] = [];
            page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
            gateway.guardUrl(url); // domain boundary (Req 13)
            const resp = await page.goto(url, { waitUntil: "load", timeout: cfg.limits.navTimeoutMs }).catch(() => null);
            const status = resp?.status() ?? 0;
            const title = (await page.title()).trim();
            const h1Visible = await page.locator("h1").first().isVisible().catch(() => false);
            const navCount = await page.locator("nav").count();
            const loadChecks: DeterministicCheck[] = [
              { name: `${vp.name}:http`, passed: status >= 200 && status < 400, detail: `HTTP ${status}` },
              { name: `${vp.name}:title`, passed: title.length > 0, detail: title || "empty" },
              { name: `${vp.name}:h1`, passed: h1Visible, detail: h1Visible ? "visible" : "missing" },
              { name: `${vp.name}:nav`, passed: navCount > 0, detail: `${navCount} nav` },
            ];
            return { context, page, resp, status, loadChecks };
          },
          (o) => summariseStep("load", { status: o.status, reached: !!o.resp, checks: o.loadChecks }),
        );
        const { context, page, resp, loadChecks } = loaded;
        // Only pages actually reached count as scanned (a failed navigation is not evidence of a fix).
        if (resp) scannedPairs.push({ pageUrl: url, viewport: vp.name });

        const shotDir = join(store.runDir, "screenshots");
        const shot = join(shotDir, `${slug}.${vp.name}.png`);
        await recordStep(
          tel,
          { ...stepMeta, step: "screenshot" },
          async () => {
            await takeScreenshot(page, shot);
            store.addEvidence({ kind: "screenshot", path: shot, page: url, viewport: vp.name });
          },
          () => summariseStep("screenshot", undefined),
        );
        pageEvidence.push({ kind: `screenshot-${vp.name}`, path: shot });

        // Visual comparison vs approved screenshot baseline (Phase 2).
        const visual = await recordStep(
          tel,
          { ...stepMeta, step: "visual-compare" },
          () => compareScreenshot(slug, vp.name, shot, store.runDir),
          (v) => summariseStep("visual-compare", v),
        );
        visualByViewport[vp.name] = visual;
        if (visual.baselinePath) pageEvidence.push({ kind: `baseline-${vp.name}`, path: visual.baselinePath });
        if (visual.diffPath) pageEvidence.push({ kind: `diff-${vp.name}`, path: visual.diffPath });

        const axe = await recordStep(
          tel,
          { ...stepMeta, step: "accessibility-scan" },
          async () => {
            const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
            store.writeJson(join("accessibility", `${slug}.${vp.name}.json`), { url, viewport: vp.name, violations: res.violations });
            return res;
          },
          (res) => summariseStep("accessibility-scan", { violations: res.violations }),
        );
        const cs = axe.violations.filter((v: { impact: string | null }) => v.impact === "critical" || v.impact === "serious");

        pageChecks.push(
          ...loadChecks,
          { name: `${vp.name}:a11y-critical-serious`, passed: cs.length === 0, detail: cs.map((v: { id: string }) => v.id).join(", ") || "none" },
        );
        await page.close();
        await context.close();
        tel.agentStatus("Observation_Runner", "deterministic", "completed", undefined);
      }

      // Visual difference => visual finding (unless a deterministic rule failed).
      const anyDetFail = pageChecks.some((c) => !c.passed);
      const anyVisualDiff = Object.values(visualByViewport).some((v) => v.differs);
      tel.agentStatus("Comparator", "deterministic", "working");
      const pageMeta = { pageUrl: url, slug, seq } as const;
      const result = await recordStep(
        tel,
        { ...pageMeta, step: "compare", agent: "Comparator" },
        () =>
          compare({
            page: url,
            deterministicChecks: pageChecks,
            observedDifferences: [],
            screenshotDiffers: anyVisualDiff,
            screenshotDeterministicRuleViolated: anyVisualDiff && anyDetFail,
          }),
        (r) => summariseStep("compare", { outcomes: r.outcomes.length, failedChecks: r.failedCheckCount }),
      );
      tel.agentStatus("Comparator", "deterministic", "completed");

      // AI agents (labeled, linked).
      tel.agentStatus("Quality_Analysis_Agent", "template", "working");
      const aiItems: AiItem[] = await recordStep(
        tel,
        { ...pageMeta, step: "notes", agent: "Quality_Analysis_Agent" },
        () => {
          const items: AiItem[] = [];
          for (const o of result.outcomes) {
            items.push(qualityAnalysis(o));
            const ve = visualExplanation(o);
            if (ve) items.push(ve);
          }
          return items;
        },
        (items) => summariseStep("notes", { items: items.length }),
      );
      if (result.outcomes.length > 0) {
        tel.agentStatus("Triage_Agent", "template", "working");
        const triageItem = await recordStep(
          tel,
          { ...pageMeta, step: "triage", agent: "Triage_Agent" },
          () => triageRecommendation(result.outcomes),
          () => summariseStep("triage", { items: 1 }),
        );
        aiItems.push(triageItem);
        tel.agentStatus("Triage_Agent", "template", "completed");
      }
      tel.agentStatus("Quality_Analysis_Agent", "template", "completed");

      allOutcomes.push(...result.outcomes);
      allAiItems.push(...aiItems);
      totalFailedChecks += result.failedCheckCount;
      pageReports.push({
        page: url,
        slug,
        baselineVersion: `v${version}`,
        checks: pageChecks,
        outcomes: result.outcomes,
        aiItems,
        visual: visualByViewport,
        evidence: pageEvidence,
      });
    }
  } finally {
    await browser.close();
  }

  writeTestManifest(store.runDir, generated);
  // Phase 2 migration (Req 8.2, 11.8): test-manifest.json now stores repo-relative
  // specPath values (no absolute/internal paths). Record the migration as an
  // append-only audit note. Existing on-disk manifests are left as-is and are
  // sanitized at publish time.
  tel.audit({
    type: "migration",
    reason: "test-manifest.specPath is now repo-relative (Req 8.2, 11.8)",
    detail: "Phase 2: absolute specPath no longer written; legacy manifests sanitized at publish.",
  });
  store.writeJson("results.json", { pages: pageReports.map((p) => ({ page: p.page, slug: p.slug, checks: p.checks })) });

  const awaitingReview = allOutcomes.some((o) => o.requiresHumanReview);
  store.writeJson("findings.json", {
    runId,
    correlationId,
    awaitingReview,
    pages: pageReports.map((p) => ({
      page: p.page,
      slug: p.slug,
      outcomes: p.outcomes,
      aiItems: p.aiItems,
      visual: sanitizeVisual(p.visual),
    })),
  });

  // Run trigger marker (one-line text file, like the `origin` marker). Only a
  // short [a-z_]+ token is written; anything else is omitted.
  const triggerEnv = (process.env.AWG_RUN_TRIGGER ?? "").trim();
  if (/^[a-z_]{1,32}$/.test(triggerEnv)) {
    writeFileSync(join(store.runDir, "trigger"), triggerEnv, "utf8");
  }

  // Run-source marker (run-source.json): absent outside CI.
  writeRunSourceMarker(store.runDir, process.env);

  // Run origin marker: "cloud" only when AWG_RUN_ORIGIN is exactly "cloud", else "local".
  writeFileSync(join(store.runDir, "origin"), runOriginMarker(process.env.AWG_RUN_ORIGIN), "utf8");

  tel.runRecord({
    runId,
    correlationId,
    startedAt,
    finishedAt: new Date().toISOString(),
    targetEnvironment: "production-public",
    baseUrl: cfg.baseUrl,
    browser: "chromium",
    viewport: "desktop+mobile",
    testSuiteVersion: "milestone-2",
    pagesRequested: approvedUrls,
    result: totalFailedChecks > 0 ? "requires-human-review" : "passed",
    evidenceRefs: store.listEvidence().map((e) => e.evidenceId),
  });

  const lifecycle = await recordStep(
    tel,
    { step: "history", agent: "Lifecycle_Tracker", seq },
    () => {
      const lc = computeLifecycleForRun(
        store.runDir,
        runId,
        new Date().toISOString(),
        scannedPairs,
        resolve("artifacts", "a11y-history.json"),
        resolve("artifacts", "a11y-history.status.json"),
        tel,
      );
      store.writeJson("a11y-history-summary.json", lc.summary);
      return lc;
    },
    (lc) =>
      summariseStep("history", {
        status: lc.historyStatus,
        tracked: Object.values(lc.summary).reduce((a, b) => a + b, 0),
      }),
  );
  tel.event("a11y.history", { data: lifecycle.summary });

  // Freeze the applied dispositions for this run (read the log once; never re-evaluated later).
  await recordStep(
    tel,
    { step: "decisions", agent: "Decision_Recorder", seq },
    () => freezeDispositions(store.runDir, runId, new Date().toISOString()),
    (d) => summariseStep("decisions", { status: d.status, entries: d.entries.length }),
  );

  const health: ReportModel["websiteHealth"] = totalFailedChecks > 0 ? "attention" : "healthy";
  const model: ReportModel = {
    runId,
    correlationId,
    generatedAt: new Date().toISOString(),
    pages: pageReports,
    agentStatuses: [
      { agent: "Test_Generator", status: "completed" },
      { agent: "Observation_Runner", status: "completed" },
      { agent: "Comparator", status: "completed" },
      { agent: "Quality_Analysis_Agent", status: "completed" },
      { agent: "Triage_Agent", status: "completed" },
    ],
    websiteHealth: health,
    totalFailedChecks,
    pendingReview: awaitingReview,
  };
  try {
    writeReport(store.runDir, model);
    writeDashboard(resolve("artifacts", "dashboard.html"), model);
    buildDashboard("artifacts/dashboard.html");
  } catch (err) {
    tel.event("dashboard.regeneration-failed", { message: String(err) });
    throw new Error(`Dashboard/report generation failed; run marked failed. ${String(err)}`);
  }

  tel.event("run.finished", { data: { health, failedChecks: totalFailedChecks, pages: pageReports.length } });
  applyRetention("artifacts/runs", cfg.retention.maxRuns, cfg.retention.maxAgeDays);

  // Local publish on SUCCESSFUL run completion only (Req 6.7). We reach this
  // point exclusively on the success path — a dashboard/report failure above
  // throws before here, so a thrown run never publishes.
  //
  // NON-FATAL by design: publishing is a downstream artifact step, not part of
  // the observation run's correctness. If publish fails it MUST leave the prior
  // published bundle untouched (the publisher guarantees this, Req 6.8/6.9) and
  // MUST NOT retroactively fail an otherwise-good run — a publish hiccup should
  // never discard a valid observation. So we record a telemetry event and carry
  // on, returning the runId regardless. The office is the static, no-build
  // `office/` app (copied as-is into the Pages output); the publisher only
  // assembles data/ + the static dashboard, so no office toolchain is involved.
  //
  // CI assembles ./_site via its own pipeline (build-published-data + copying
  // office/), so set AWG_SKIP_LOCAL_PUBLISH=1 there to avoid a redundant
  // in-process publish.
  if (process.env.AWG_SKIP_LOCAL_PUBLISH !== "1") {
    try {
      const result = await publish({ outDir: LOCAL_PUBLISHED_DIR });
      if (result.ok) {
        tel.event("publish.completed", {
          data: { outDir: LOCAL_PUBLISHED_DIR, publishedRunId: result.publishedRunId, withheld: result.withheld.length },
        });
      } else {
        tel.event("publish.failed", { message: result.reason ?? "publish returned not-ok" });
      }
    } catch (err) {
      // Swallow: prior published data is preserved by the publisher; the run
      // itself remains successful.
      tel.event("publish.failed", { message: String(err) });
    }
  }

  return runId;
}

export class ManualTrigger implements RunTrigger {
  readonly kind = "manual" as const;
  start(cfg: AppConfig): Promise<string> {
    return runGuardian(cfg);
  }
}



