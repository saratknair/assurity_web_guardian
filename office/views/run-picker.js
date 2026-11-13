/**
 * Run picker view.
 *
 * createRunPicker(host, handlers) -> { update(model), dispose() }
 *
 * model: {
 *   runs: Array<{ runId: string, finishedAt?: string, health?: string }>,  // Run_Index entries, newest first
 *   selectedRunId: string|null,
 *   loading?: boolean            // disables the select while a run loads
 * }
 *
 * handlers: onSelectRun(runId)
 *
 * No DOM access at import time. DOM is built with office/lib/dom.js only.
 */
import { el, setChildren } from "../lib/dom.js";
import { formatLocalDateTime } from "../lib/format.js";

/** Pure: option text with date, local time (zone shown) and health. timeZone is for tests. */
export function runOptionLabel(run, timeZone) {
  const r = run || {};
  const when = formatLocalDateTime(r.finishedAt, timeZone);
  const health = typeof r.health === "string" && r.health ? r.health : "not recorded";
  return when + ", health " + health;
}

let uid = 0;

export function createRunPicker(host, handlers) {
  const h = handlers || {};
  const id = "runpick" + (uid++);
  const last = {};
  const select = el("select", { id: id, class: "select" });
  setChildren(host, [el("label", { for: id, text: "Run" }), select]);

  function onChange() {
    if (typeof h.onSelectRun === "function" && select.value) h.onSelectRun(select.value);
  }
  select.addEventListener("change", onChange);

  function update(model) {
    const m = model || {};
    const runs = Array.isArray(m.runs) ? m.runs : [];
    const key = runs.map(function (r) { return r.runId + "\u0001" + runOptionLabel(r); }).join("\u0002");
    if (last.key !== key) {
      last.key = key;
      const opts = runs.map(function (r) {
        return el("option", { value: r.runId, text: runOptionLabel(r) });
      });
      if (opts.length === 0) opts.push(el("option", { value: "", text: "No runs available" }));
      setChildren(select, opts);
      last.sel = undefined;
    }
    const sel = m.selectedRunId || "";
    if (last.sel !== sel) {
      last.sel = sel;
      if (sel) select.value = sel;
    }
    const disabled = runs.length === 0 || !!m.loading;
    if (last.disabled !== disabled) {
      last.disabled = disabled;
      select.disabled = disabled;
    }
  }

  function dispose() {
    select.removeEventListener("change", onChange);
    setChildren(host, null);
  }

  update({});
  return { update: update, dispose: dispose };
}
