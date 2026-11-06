// Assurity Web Guardian - Visual_Comparison view (#/visual/<runId>/<slug>/<viewport>).
// Three figures (Approved baseline, Current run, Difference highlight), an
// in-place baseline/current switch, honest reasons for missing images, and a
// lightbox opened from each figure. createElement / textContent only.
// No window/document access at import time.

import { el, append, link, button, uniqueId, formatDateTime } from "./common.js";
import { evidenceCaption, imageAlt, imageUnavailableText, DIFF_LEGEND } from "../lib/captions.js";
import { measureText } from "../lib/summary.js";
import { openLightbox } from "./lightbox.js";

const ROLES = [
  { role: "baseline", label: "Approved baseline" },
  { role: "current", label: "Current run" },
  { role: "diff", label: "Difference highlight" },
];

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function imageUrl(runId, rel) {
  const parts = String(rel).split("/").map((p) => encodeURIComponent(p));
  return "./data/runs/" + encodeURIComponent(runId) + "/" + parts.join("/");
}

export async function render(container, ctx) {
  const route = ctx.route;
  const bundle = await ctx.loadRun(route.runId, ["visual"]);
  if (typeof ctx.isCurrent === "function" && !ctx.isCurrent()) return;
  const run = bundle && bundle.run;
  const visual = bundle && bundle.visual;
  const items = isObj(visual) && Array.isArray(visual.items) ? visual.items : [];
  const item = items.find((i) => isObj(i) && i.slug === route.slug && i.viewport === route.viewport);
  if (!item) {
    ctx.notFound(container);
    return;
  }

  const runId = route.runId;
  const runFinishedAt = isObj(run) ? run.finishedAt : undefined;
  const index = ctx.state && ctx.state.index;
  const retention = isObj(index) ? index.imageRetentionRuns : undefined;
  const images = isObj(item.images) ? item.images : {};
  const base = isObj(item.baseline) ? item.baseline : {};
  const pageUrl = item.pageUrl || "";

  const h2text = "Visual comparison: " + (pageUrl || route.slug) + " (" + route.viewport + ")";
  container.appendChild(el("h2", "view-title", h2text));

  // Links back to the finding and the page.
  const nav = el("p", "muted");
  if (item.findingId) {
    append(nav, link("Back to the finding", ctx.formatRoute({ view: "finding", runId, findingId: item.findingId })), " ");
  }
  append(nav, link("Open the page", ctx.formatRoute({ view: "page", slug: route.slug })));
  container.appendChild(nav);

  // Facts: measure and run date.
  const mt = item.dimensionsChanged ? "" : measureText(item.measure);
  const facts = el("div", "notice");
  facts.appendChild(el("p", "", "Run date: " + (isObj(run) && run.finishedAt ? formatDateTime(run.finishedAt) : "Run not recorded")));
  if (item.dimensionsChanged) {
    facts.appendChild(el("p", "", "The screenshot size changed since the approved baseline, so pixels cannot be compared one to one."));
  }
  facts.appendChild(el("p", "", mt || "Difference measure not recorded for this run"));
  if (isObj(item.measure) && item.measure.source === "derived-from-diff-image") {
    facts.appendChild(el("p", "muted", "This measure was derived from the difference image."));
  }
  if (item.suppressed === true) {
    const ids = Array.isArray(item.suppressedBy) ? item.suppressedBy.filter((s) => typeof s === "string") : [];
    facts.appendChild(el("p", "", "A failing rule on this page also needs attention" + (ids.length ? " (" + ids.join(", ") + ")" : "") + "."));
  }
  container.appendChild(facts);

  const capCtx = (role) => ({
    role,
    pageUrl,
    viewport: route.viewport,
    runId,
    runFinishedAt,
    baselineApprovedAt: base.approvedAt || "",
    baselineSourceRunId: base.sourceRunId || "",
  });

  const hasBaseline = typeof images.baseline === "string" && images.baseline.length > 0;
  const hasCurrent = typeof images.current === "string" && images.current.length > 0;

  // Honest reason when there is no baseline figure.
  if (!hasBaseline) {
    const reason = base.reason || "";
    const p = el("p", "notice notice--warn", "The baseline image was not published for this run. " + imageUnavailableText(reason, retention, "baseline"));
    container.appendChild(p);
  }

  // In-place baseline/current switch (flicker comparison).
  let swapFigure = null;
  const figureState = {};
  if (hasBaseline && hasCurrent) {
    const row = el("p", "");
    const sw = button("Show current run in the baseline position", "btn", { role: "switch", "aria-checked": "false" });
    sw.addEventListener("click", () => {
      const on = sw.getAttribute("aria-checked") !== "true";
      sw.setAttribute("aria-checked", on ? "true" : "false");
      if (swapFigure) swapFigure(on);
    });
    row.appendChild(sw);
    container.appendChild(row);
  }

  const grid = el("div", "figure-grid");
  grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(min(100%, 22rem), 1fr))";

  for (const r of ROLES) {
    const rel = images[r.role];
    const has = typeof rel === "string" && rel.length > 0;
    if (r.role === "baseline" && !has) continue; // no baseline figure at all
    const fig = el("figure", "figure");
    const capId = uniqueId("fig-cap");
    const state = { role: r.role, rel, has };
    figureState[r.role] = state;
    fig.appendChild(el("h3", "section-title", r.label));
    const caption = el("figcaption", "caption", evidenceCaption(capCtx(r.role)), { id: capId });
    state.caption = caption;
    state.fig = fig;

    if (!has) {
      const reason = r.role === "baseline" ? base.reason : base.reason === "image-retention" ? "image-retention" : "";
      fig.appendChild(el("p", "empty-state__body", imageUnavailableText(reason, retention, r.role)));
    } else {
      const region = el("div", "", null, {
        role: "region",
        tabindex: "0",
        "aria-label": r.label + " image, scrollable",
      });
      region.style.maxHeight = "70vh";
      region.style.overflow = "auto";
      const open = button("", "figure__open", { "data-focus-key": "fig-" + r.role });
      const img = document.createElement("img");
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
      state.img = img;
      state.open = open;
      state.region = region;
      const apply = (srcRole) => {
        const url = imageUrl(runId, images[srcRole]);
        const alt = imageAlt(capCtx(srcRole));
        img.setAttribute("alt", alt);
        img.setAttribute("src", url);
        open.setAttribute("aria-label", "Open " + alt);
        state.url = url;
        state.alt = alt;
        state.cap = evidenceCaption(capCtx(srcRole));
      };
      state.apply = apply;
      apply(r.role);
      img.addEventListener("error", () => {
        if (img.parentNode) img.parentNode.removeChild(img);
        open.disabled = true;
        open.removeAttribute("aria-label");
        open.appendChild(el("span", "muted", "Image could not be loaded"));
      });
      open.addEventListener("click", () => {
        openLightbox({ src: state.url, alt: state.alt, caption: state.cap }, open);
      });
      open.appendChild(img);
      region.appendChild(open);
      fig.appendChild(region);
    }
    fig.appendChild(caption);
    grid.appendChild(fig);
  }
  container.appendChild(grid);

  swapFigure = (on) => {
    const b = figureState.baseline;
    if (!b || !b.apply || !b.img) return;
    // Restore a failed image slot is not possible; only swap when loaded.
    if (!b.img.parentNode) return;
    b.apply(on ? "current" : "baseline");
    const role = on ? "current" : "baseline";
    b.caption.textContent = evidenceCaption(capCtx(role));
    const heading = b.fig.querySelector("h3");
    if (heading) heading.textContent = on ? "Current run (shown in the baseline position)" : "Approved baseline";
  };

  return { announce: h2text };
}
