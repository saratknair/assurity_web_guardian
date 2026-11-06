// Assurity Web Guardian - shared findings list renderer.
// Plain browser ES module, ASCII-only. NOT a routed view.
//
// Used by the Run_View (views/run-view.js) and the Filtered_Findings_View
// (views/filtered-findings.js). Builds nodes with createElement / textContent
// only. Nothing here touches window/document at import time.
//
// Export (signature is stable):
//
//   renderFindingsList(host, findings, ctx, opts?) -> HTMLElement
//
//   host      element the list block is APPENDED to (it is not cleared).
//   findings  array of normalized Findings (dashboard/lib/findings.js), already
//             filtered and sorted by the caller. Shown in the given order.
//   ctx       view context; uses ctx.formatRoute and, when present,
//             ctx.announce.
//   opts      {
//               runId:     string, used for the Finding_Detail_View links,
//               limit:     block size (default 100). More items are revealed
//                          with a "Show more" button, one block at a time,
//               emptyText: text when the array is empty
//                          (default "No findings to show"),
//             }
//
//   Returns the wrapper <div class="findings-list"> holding a <ul> of <li>
//   items and (when more than `limit` items exist) a "Show more" button.
//   Each <li> has one primary link (the rule or check) to
//   #/finding/<runId>/<findingId>, then page URL, viewport, severity badge and
//   the Plain_English_Summary. A Finding without an id has no link.
//   Focus moves to the first newly added item link after "Show more".

import { plainEnglishSummary } from "../lib/summary.js";
import { el, button, badge, link } from "./common.js";

export const FINDINGS_BLOCK_SIZE = 100;

/** Display name of the rule or check: the title when published, else the rule id. */
export function findingName(f) {
  const title = typeof f.title === "string" ? f.title.trim() : "";
  const rule = typeof f.ruleId === "string" ? f.ruleId : "";
  if (f.kind === "check") {
    const name = rule.indexOf("check:") === 0 ? rule.slice("check:".length) : rule;
    return title || name || "Check";
  }
  return title || rule || "Finding";
}

function buildItem(f, ctx, runId) {
  const li = el("li", "finding-item");
  const head = el("div", "finding-item__head");
  const name = findingName(f);
  let primary = null;
  if (f.id && runId) {
    const href = ctx.formatRoute({ view: "finding", runId, findingId: f.id });
    primary = link(name, href, "finding-item__link", { "data-focus-key": "finding:" + f.id });
    head.appendChild(primary);
  } else {
    head.appendChild(el("span", "finding-item__link", name));
  }
  head.appendChild(badge(f.severity));
  li.appendChild(head);

  const rule = typeof f.ruleId === "string" ? f.ruleId : "";
  const meta = el("p", "muted finding-item__meta");
  const bits = [];
  bits.push(f.pageUrl || "Page not recorded");
  bits.push(f.viewport ? f.viewport + " viewport" : "viewport not recorded");
  if (rule) bits.push((f.kind === "check" ? "Check: " : "Rule: ") + rule);
  meta.textContent = bits.join(" | ");
  li.appendChild(meta);

  li.appendChild(el("p", "finding-item__summary", plainEnglishSummary(f)));
  return { li, primary };
}

export function renderFindingsList(host, findings, ctx, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const runId = typeof o.runId === "string" ? o.runId : "";
  const block = Number.isFinite(o.limit) && o.limit > 0 ? Math.floor(o.limit) : FINDINGS_BLOCK_SIZE;
  const list = Array.isArray(findings) ? findings : [];
  const wrap = el("div", "findings-list");

  if (!list.length) {
    wrap.appendChild(el("p", "muted", typeof o.emptyText === "string" ? o.emptyText : "No findings to show"));
    host.appendChild(wrap);
    return wrap;
  }

  const ul = el("ul", "finding-list");
  wrap.appendChild(ul);
  let shown = 0;
  let moreBtn = null;

  function addBlock() {
    const end = Math.min(list.length, shown + block);
    let firstNew = null;
    for (; shown < end; shown += 1) {
      const item = buildItem(list[shown], ctx, runId);
      if (!firstNew && item.primary) firstNew = item.primary;
      ul.appendChild(item.li);
    }
    return firstNew;
  }

  function refreshMore() {
    if (shown >= list.length) {
      if (moreBtn && moreBtn.parentNode) moreBtn.parentNode.removeChild(moreBtn);
      moreBtn = null;
      return;
    }
    const left = list.length - shown;
    const text = "Show more (" + Math.min(block, left) + " of " + left + " remaining)";
    if (!moreBtn) {
      moreBtn = button(text, "btn", { "data-focus-key": "findings-more" });
      moreBtn.addEventListener("click", () => {
        const firstNew = addBlock();
        refreshMore();
        if (typeof ctx.announce === "function") ctx.announce("Showing " + shown + " of " + list.length + " findings");
        if (firstNew && typeof firstNew.focus === "function") firstNew.focus();
        else if (moreBtn && typeof moreBtn.focus === "function") moreBtn.focus();
      });
      wrap.appendChild(moreBtn);
    } else {
      moreBtn.textContent = text;
    }
  }

  addBlock();
  refreshMore();
  host.appendChild(wrap);
  return wrap;
}
