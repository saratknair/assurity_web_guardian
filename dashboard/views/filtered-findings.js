// Assurity Web Guardian - Filtered_Findings_View (#/findings?...).
// Plain browser ES module, ASCII-only.
//
// Contract: `export async function render(container, ctx)` (see the VIEW MODULE
// CONTRACT comment in app.js). Renders exactly one <h2>. All dynamic text goes
// through textContent (never markup strings). No form element is used.
//
// Shows the active filters as removable chips, the count ("Showing 12
// findings"), checkbox controls for Severity, Lifecycle state, Page group and
// a rule id picker, and the findings list (rendered by findings-list.js, in
// blocks of 100 with a "Show more" button). Every filter change navigates, so
// the filters are recorded in the Deep_Link (R11.8). Default scope is
// "active"; scope=ignored lists run.ignored.
//
// Pure helpers are exported for tests and never touch window/document at
// import time: pickRunId, withParam, withoutParam, clearedParams,
// activeChips, countText, emptyMessage, isFiltered.

import { SEVERITY_ORDER, label as sevLabel } from "../lib/severity.js";
import { LIFECYCLE_PRESENT, LIFECYCLE_LABELS, filterFindings, sortFindings } from "../lib/findings.js";
import { el, append, clear, button, link, errorBanner, loading, plural, uniqueId } from "./common.js";
import { renderFindingsList } from "./findings-list.js";

const LIST_KEYS = ["sev", "state", "group", "rule"];
const FILTER_KEYS = ["q", "sev", "state", "has", "group", "rule", "page"];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Selected run id: route param, else dashboard.latest.runId, else newest in the index. */
export function pickRunId(params, state) {
  const p = isObj(params) ? params : {};
  if (typeof p.run === "string" && p.run) return p.run;
  const s = isObj(state) ? state : {};
  const d = isObj(s.dashboard) ? s.dashboard : {};
  if (isObj(d.latest) && typeof d.latest.runId === "string" && d.latest.runId) return d.latest.runId;
  const idx = isObj(s.index) && Array.isArray(s.index.runs) ? s.index.runs : Array.isArray(s.index) ? s.index : [];
  const first = idx.find((r) => isObj(r) && typeof r.runId === "string" && r.runId);
  if (first) return first.runId;
  const runs = Array.isArray(d.runs) ? d.runs : [];
  const f2 = runs.find((r) => isObj(r) && typeof r.runId === "string" && r.runId);
  return f2 ? f2.runId : "";
}

/** New params with `value` added to (on=true) or removed from a list param. */
export function withParam(params, key, value, on) {
  const out = Object.assign({}, isObj(params) ? params : {});
  const cur = Array.isArray(out[key]) ? out[key].slice() : [];
  const has = cur.includes(value);
  if (on && !has) cur.push(value);
  if (!on && has) cur.splice(cur.indexOf(value), 1);
  if (cur.length) out[key] = cur;
  else delete out[key];
  return out;
}

/** New params with a filter removed: one list value, or a whole scalar param. */
export function withoutParam(params, key, value) {
  if (LIST_KEYS.includes(key)) return withParam(params, key, value, false);
  const out = Object.assign({}, isObj(params) ? params : {});
  delete out[key];
  return out;
}

/** Params with every filter removed; run, scope, sort and dir are kept. */
export function clearedParams(params) {
  const out = Object.assign({}, isObj(params) ? params : {});
  for (const k of FILTER_KEYS) delete out[k];
  return out;
}

export function isFiltered(params) {
  const p = isObj(params) ? params : {};
  return FILTER_KEYS.some((k) => (Array.isArray(p[k]) ? p[k].length > 0 : typeof p[k] === "string" && p[k] !== ""));
}

function chipValueText(key, value) {
  if (key === "sev") return sevLabel(value).toLowerCase();
  if (key === "state") return LIFECYCLE_LABELS[value] ? LIFECYCLE_LABELS[value].toLowerCase() : value;
  return value;
}

const CHIP_NAME = {
  q: "search",
  sev: "severity",
  state: "state",
  has: "element detail",
  group: "page group",
  rule: "rule",
  page: "page",
};

/** Active filters as [{ key, value, text }] where text is e.g. "severity critical". */
export function activeChips(params) {
  const p = isObj(params) ? params : {};
  const out = [];
  for (const key of FILTER_KEYS) {
    const v = p[key];
    const values = Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];
    for (const value of values) {
      out.push({ key, value, text: CHIP_NAME[key] + " " + chipValueText(key, value) });
    }
  }
  return out;
}

export function countText(n, scope) {
  const noun = scope === "ignored" ? ["ignored finding", "ignored findings"] : ["finding", "findings"];
  return "Showing " + plural(n, noun[0], noun[1]);
}

/** Text for an empty result. */
export function emptyMessage(scope, filtered) {
  if (filtered) return "No findings match these filters";
  return scope === "ignored" ? "No issues are ignored in this run" : "No active findings in this run";
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function checkboxFieldset(legend, name, options, selected, onToggle, focusPrefix) {
  const fs = el("fieldset", "filter-group");
  fs.appendChild(el("legend", "", legend));
  if (!options.length) {
    fs.appendChild(el("p", "muted", "None in this run"));
    return fs;
  }
  const list = el("ul", "filter-options");
  for (const opt of options) {
    const id = uniqueId("ff-" + name);
    const li = el("li");
    const cb = el("input", "", null, { type: "checkbox", id, "data-focus-key": focusPrefix + ":" + opt.value });
    cb.checked = selected.includes(opt.value);
    cb.addEventListener("change", () => onToggle(opt.value, cb.checked, focusPrefix + ":" + opt.value));
    const lab = el("label", "", opt.label + (typeof opt.count === "number" ? " (" + opt.count + ")" : ""), { for: id });
    append(li, cb, lab);
    list.appendChild(li);
  }
  fs.appendChild(list);
  return fs;
}

function tally(list, pick) {
  const m = new Map();
  for (const f of list) {
    const k = pick(f);
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

export async function render(container, ctx) {
  const route = ctx.route;
  const params = isObj(route.params) ? route.params : {};
  const scope = params.scope === "ignored" ? "ignored" : "active";

  clear(container);
  const wrap = el("div", "view findings-view");
  container.appendChild(wrap);
  wrap.appendChild(el("h2", "view-title", scope === "ignored" ? "Ignored findings" : "Findings"));

  const runId = pickRunId(params, ctx.state);
  if (!runId) {
    wrap.appendChild(el("p", "empty", "No runs are published yet."));
    return { announce: "No runs are published yet." };
  }

  const status = loading("Loading findings...");
  wrap.appendChild(status);
  let run;
  try {
    run = (await ctx.loadRun(runId)).run;
  } catch (e) {
    if (typeof ctx.isCurrent === "function" && !ctx.isCurrent()) return undefined;
    clear(status);
    status.remove();
    wrap.appendChild(errorBanner("runs/" + runId + "/run-findings.json", { detail: e && e.message }));
    return undefined;
  }
  if (typeof ctx.isCurrent === "function" && !ctx.isCurrent()) return undefined;
  status.remove();

  const universe = scope === "ignored" ? run.ignored : run.findings;
  const matches = sortFindings(filterFindings(run, params), params);

  const go = (nextParams, focusKey) => {
    ctx.navigate({ view: "findings", params: nextParams }, focusKey ? { focusKey } : undefined);
  };

  // Header: run and scope switch.
  const meta = el("p", "findings-meta");
  append(meta, "Run: " + runId + ". ");
  const other = scope === "ignored" ? "active" : "ignored";
  const otherParams = Object.assign({}, params, { scope: other });
  append(
    meta,
    link(
      scope === "ignored" ? "Show active findings" : "Show ignored findings",
      ctx.formatRoute({ view: "findings", params: otherParams })
    )
  );
  wrap.appendChild(meta);

  // Active filter chips.
  const chips = activeChips(params);
  const chipBox = el("div", "filter-chips");
  chipBox.appendChild(el("h3", "section-title", "Active filters"));
  if (!chips.length) {
    chipBox.appendChild(el("p", "muted", "No filters applied."));
  } else {
    const ul = el("ul", "chip-list");
    for (const c of chips) {
      const li = el("li");
      const b = button("", "chip", { "aria-label": "Remove filter: " + c.text, "data-focus-key": "chip:" + c.key + ":" + c.value });
      append(b, el("span", "chip-text", c.text), el("span", "chip-x", " x", { "aria-hidden": "true" }));
      b.addEventListener("click", () => go(withoutParam(params, c.key, c.value), "filters"));
      li.appendChild(b);
      ul.appendChild(li);
    }
    chipBox.appendChild(ul);
    const clr = button("Clear all filters", "chip-clear", { "data-focus-key": "clear-filters" });
    clr.addEventListener("click", () => go(clearedParams(params), "clear-filters"));
    chipBox.appendChild(clr);
  }
  wrap.appendChild(chipBox);

  // Controls.
  const controls = el("div", "filter-controls", null, { role: "group", "aria-label": "Filter controls" });
  const sevCounts = tally(universe, (f) => f.severity);
  const stateCounts = tally(universe, (f) => f.lifecycle);
  const groupCounts = tally(universe, (f) => f.group);
  const ruleCounts = tally(universe, (f) => f.ruleId);

  const sevOpts = SEVERITY_ORDER.filter((s) => sevCounts.has(s) || (params.sev || []).includes(s)).map((s) => ({
    value: s, label: sevLabel(s), count: sevCounts.get(s) || 0,
  }));
  const stateOpts = LIFECYCLE_PRESENT.filter((s) => stateCounts.has(s) || (params.state || []).includes(s)).map((s) => ({
    value: s, label: LIFECYCLE_LABELS[s], count: stateCounts.get(s) || 0,
  }));
  const groupNames = Array.from(new Set(Array.from(groupCounts.keys()).concat(params.group || []))).sort();
  const groupOpts = groupNames.map((g) => ({ value: g, label: g, count: groupCounts.get(g) || 0 }));

  const toggle = (key) => (value, on, fk) => go(withParam(params, key, value, on), fk);
  append(
    controls,
    checkboxFieldset("Severity", "sev", sevOpts, params.sev || [], toggle("sev"), "sev"),
    checkboxFieldset("Lifecycle state", "state", stateOpts, params.state || [], toggle("state"), "state"),
    checkboxFieldset("Page group", "group", groupOpts, params.group || [], toggle("group"), "group")
  );

  // Rule id picker: choosing a rule adds it as a filter.
  const ruleFs = el("fieldset", "filter-group");
  ruleFs.appendChild(el("legend", "", "Rule id"));
  const selectedRules = params.rule || [];
  const ruleChoices = Array.from(ruleCounts.keys()).filter((r) => !selectedRules.includes(r)).sort();
  if (!ruleChoices.length) {
    ruleFs.appendChild(el("p", "muted", selectedRules.length ? "No other rules in this run" : "None in this run"));
  } else {
    const selId = uniqueId("ff-rule");
    const sel = el("select", "", null, { id: selId, "data-focus-key": "rule-select" });
    sel.appendChild(el("option", "", "Choose a rule to filter by", { value: "" }));
    for (const r of ruleChoices) sel.appendChild(el("option", "", r + " (" + ruleCounts.get(r) + ")", { value: r }));
    sel.addEventListener("change", () => {
      if (sel.value) go(withParam(params, "rule", sel.value, true), "rule-select");
    });
    ruleFs.appendChild(el("label", "", "Add a rule id filter", { for: selId }));
    ruleFs.appendChild(sel);
  }
  controls.appendChild(ruleFs);
  wrap.appendChild(controls);

  // Count and list.
  const countEl = el("p", "findings-count", countText(matches.length, scope), { role: "status" });
  wrap.appendChild(countEl);

  const filtered = isFiltered(params);
  const listHost = el("div", "findings-list-host");
  wrap.appendChild(listHost);
  if (!matches.length) {
    const box = el("div", "empty");
    box.appendChild(el("p", "", emptyMessage(scope, filtered)));
    if (filtered) {
      const b = button("Clear filters", "chip-clear", { "data-focus-key": "clear-filters-empty" });
      b.addEventListener("click", () => go(clearedParams(params), "clear-filters-empty"));
      box.appendChild(b);
    }
    listHost.appendChild(box);
  } else {
    renderFindingsList(listHost, matches, ctx, { runId, limit: 100 });
  }

  if (typeof ctx.announce === "function") ctx.announce(countText(matches.length, scope));
  return undefined;
}
