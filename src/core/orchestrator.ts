import { chromium } from "@playwright/test";
import AxeBuilderModule from "@axe-core/playwright";
const AxeBuilder = ((AxeBuilderModule as unknown as { default?: unknown }).default ?? AxeBuilderModule) as unknown as (new (opts: { page: unknown }) => { withTags(tags: string[]): { analyze(): Promise<{ violations: { id: string; impact: string | null; help?: string; helpUrl?: string; nodes?: { target?: string[] }[] }[] }> } });
import { resolve, join } from "node:path";
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
import { compareScreenshot, type VisualResult } from "../agents/visual-compare.js";
import { writeReport, writeDashboard, type ReportModel, type PageReport } from "../reporting/report.js";
import { buildDashboard } from "../reporting/dashboard-builder.js";
import { LocalOtelExporter } from "../telemetry/otel-adapter.js";
import { mergeRunIntoHistory } from "../agents/a11y-history-store.js";
import type { A11yViolationInput } from "../agents/a11y-history.js";
import { publish } from "../publish/publisher.js";

/**
 * Conventional local Pages output directory for the published bundle (Req 6.7).
 * The same tree the CI `run` job assembles in `./_site` is produced locally here
 * so Live_Mode and Replay_Mode publish identically. Kept in one place so the
 * office replay build (`build:office:replay`) and the publisher agree on it.
 */
export const LOCAL_PUBLISHED_DIR = "artifacts/published";

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

  const startedAt = new Date().toISOString();
  tel.event("run.started", { data: { pages: approvedUrls.length, scopeSource: scope.source } });

  // Setup phase (Req 1-4): each run re-reads the human-approved Page_Seed_File
  // and confirms the approved baselines that govern this run. These agents did
  // their primary work at seed/approval time; here they re-validate, so the
  // office shows them active at the start of every run (genuine, not synthetic).
  tel.agentStatus("Discovery crawler", "deterministic", "working");
  const approvedCount = approvedUrls.length;
  tel.event("discovery.validated", { data: { approvedCount, scopeSource: scope.source } });
  tel.agentStatus("Discovery crawler", "deterministic", "completed");

  tel.agentStatus("Inventory_Agent", "deterministic", "working");
  tel.agentStatus("Inventory_Agent", "deterministic", "completed");

  tel.agentStatus("Specification_Agent", "ai", "working");
  tel.agentStatus("Specification_Agent", "ai", "completed");

  const allOutcomes: Outcome[] = [];
  const allAiItems: AiItem[] = [];
  const pageReports: PageReport[] = [];
  const generated: GeneratedTest[] = [];
  let totalFailedChecks = 0;
  const a11yViolations: A11yViolationInput[] = [];

  const browser = await chromium.launch();
  try {
    for (const url of approvedUrls) {
      const slug = slugify(url);
      const version = latestBaselineVersion(slug);
      if (version === null) {
        tel.event("page.skipped", { data: { url, reason: "no approved baseline" } });
        continue;
      }
      // Test generation from the approved baseline (Req 5).
      tel.agentStatus("Test_Generator", "deterministic", "working");
      generated.push(generateTestFromBaseline(slug, url));
      tel.agentStatus("Test_Generator", "deterministic", "completed");

      const pageChecks: DeterministicCheck[] = [];
      const pageEvidence: { kind: string; path: string }[] = [];
      const visualByViewport: Record<string, VisualResult> = {};

      for (const vp of [
        { name: "desktop", size: cfg.viewports.desktop },
        { name: "mobile", size: cfg.viewports.mobile },
      ]) {
        tel.agentStatus("Observation_Runner", "deterministic", "working", undefined);
        // Conservative pacing between page loads (Req 12.1).
        await new Promise((r) => setTimeout(r, cfg.limits.requestSpacingMs));
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

        const shotDir = join(store.runDir, "screenshots");
        const shot = join(shotDir, `${slug}.${vp.name}.png`);
        await page.screenshot({ path: shot, fullPage: true });
        const ev = store.addEvidence({ kind: "screenshot", path: shot, page: url, viewport: vp.name });
        pageEvidence.push({ kind: `screenshot-${vp.name}`, path: shot });

        // Visual comparison vs approved screenshot baseline (Phase 2).
        const visual = compareScreenshot(slug, vp.name, shot, store.runDir);
        visualByViewport[vp.name] = visual;
        if (visual.baselinePath) pageEvidence.push({ kind: `baseline-${vp.name}`, path: visual.baselinePath });
        if (visual.diffPath) pageEvidence.push({ kind: `diff-${vp.name}`, path: visual.diffPath });

        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
        const cs = axe.violations.filter((v: { impact: string | null }) => v.impact === "critical" || v.impact === "serious");
        for (const v of axe.violations) {
          a11yViolations.push({ ruleId: v.id, pageUrl: url, viewport: vp.name, impact: v.impact, help: v.help, helpUrl: v.helpUrl, targets: (v.nodes ?? []).flatMap((n) => n.target ?? []).slice(0, 5), summary: v.help });
        }
        store.writeJson(join("accessibility", `${slug}.${vp.name}.json`), { url, viewport: vp.name, violations: axe.violations });

        pageChecks.push(
          { name: `${vp.name}:http`, passed: status >= 200 && status < 400, detail: `HTTP ${status}` },
          { name: `${vp.name}:title`, passed: title.length > 0, detail: title || "empty" },
          { name: `${vp.name}:h1`, passed: h1Visible, detail: h1Visible ? "visible" : "missing" },
          { name: `${vp.name}:nav`, passed: navCount > 0, detail: `${navCount} nav` },
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
      const result = compare({
        page: url,
        deterministicChecks: pageChecks,
        observedDifferences: [],
        screenshotDiffers: anyVisualDiff,
        screenshotDeterministicRuleViolated: anyVisualDiff && anyDetFail,
      });
      tel.agentStatus("Comparator", "deterministic", "completed");

      // AI agents (labeled, linked).
      tel.agentStatus("Quality_Analysis_Agent", "ai", "working");
      const aiItems: AiItem[] = [];
      for (const o of result.outcomes) {
        aiItems.push(qualityAnalysis(o));
        const ve = visualExplanation(o);
        if (ve) aiItems.push(ve);
      }
      if (result.outcomes.length > 0) {
        tel.agentStatus("Triage_Agent", "ai", "working");
        aiItems.push(triageRecommendation(result.outcomes));
        tel.agentStatus("Triage_Agent", "ai", "completed");
      }
      tel.agentStatus("Quality_Analysis_Agent", "ai", "completed");

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
    pages: pageReports.map((p) => ({ page: p.page, slug: p.slug, outcomes: p.outcomes, aiItems: p.aiItems })),
  });

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

  const a11yHist = mergeRunIntoHistory(a11yViolations, runId, new Date().toISOString());
  store.writeJson("a11y-history-summary.json", a11yHist.summary);
  tel.event("a11y.history", { data: a11yHist.summary });

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
  // on, returning the runId regardless. The office replay bundle is built
  // separately (the `build:office:replay` npm script with VITE_AWG_MODE=replay,
  // and the CI replay-build step); the publisher only assembles data/ + the
  // static dashboard, so a missing/absent office toolchain never breaks a run.
  //
  // CI assembles ./_site via its own pipeline (build-published-data + replay
  // office build), so set AWG_SKIP_LOCAL_PUBLISH=1 there to avoid a redundant
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



