// Findings and decisions: mark resolved, ignore, un-ignore, and the list of decisions.
// Text is set with textContent only. The decision form is a native <dialog>.

const REVIEWER_KEY = "awg.reviewer";
const MAX_REASON = 500;
const MAX_REVIEWER = 80;
const NOTICE_PUBLIC = "Reason and reviewer name are published on the public Dashboard.";
const NOTICE_NEXT_RUN = "Takes effect from the next run. Earlier runs keep their original counts.";

function readReviewer() {
  try {
    return window.localStorage.getItem(REVIEWER_KEY) || "";
  } catch (e) {
    return "";
  }
}

function saveReviewer(name) {
  try {
    window.localStorage.setItem(REVIEWER_KEY, name);
  } catch (e) {
    /* remembering the name is optional */
  }
}

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

/** Find the active (not undone) ignore entry that hides this finding, for Un-ignore. */
function findIgnoreEntry(finding, entries) {
  const candidates = entries.filter((e) => e.decision === "ignore" && !e.undone);
  let best = null;
  for (const e of candidates) {
    const m = e.matcher;
    if (m.ruleId !== "" && m.ruleId !== finding.ruleId) continue;
    if (m.pageUrl !== "" && m.pageUrl !== finding.pageUrl) continue;
    if (m.viewport !== "" && m.viewport !== finding.viewport) continue;
    if (m.cssTarget !== "" && finding.nodeTargets.indexOf(m.cssTarget) < 0) continue;
    if (best === null || e.at > best.at) best = e;
  }
  return best;
}

export async function render(root, ctx) {
  const { el, api, announce, showAlert } = ctx;
  let findings = [];
  let entries = [];
  let runInfo = null;
  let notYetSynced = 0;

  const intro = el("p", { text: NOTICE_NEXT_RUN });
  const findingsPanel = el("section", { class: "panel", "aria-labelledby": "findings-h" });
  const decisionsPanel = el("section", { class: "panel", "aria-labelledby": "decisions-h" });
  root.appendChild(intro);
  root.appendChild(findingsPanel);
  root.appendChild(decisionsPanel);

  // ---- decision dialog ----------------------------------------------------
  const dialog = el("dialog", { "aria-labelledby": "dlg-title" });
  const dlgTitle = el("h3", { id: "dlg-title", text: "Decision" });
  const dlgTarget = el("p", { id: "dlg-target" });
  const scopeSet = el("fieldset");
  const scopeLegend = el("legend", { text: "Apply to" });
  const targetWrap = el("p");
  const targetLabel = el("label", { for: "dlg-css", text: "Element" });
  const targetSelect = el("select", { id: "dlg-css" });
  const matchText = el("p", { id: "dlg-matches", role: "status", "aria-live": "polite" });
  const reasonLabel = el("label", { for: "dlg-reason", text: "Reason (required, up to 500 characters)" });
  const reasonInput = el("textarea", { id: "dlg-reason", rows: "3", maxlength: String(MAX_REASON), required: "required" });
  const reviewerLabel = el("label", { for: "dlg-reviewer", text: "Reviewer (required, up to 80 characters)" });
  const reviewerInput = el("input", { id: "dlg-reviewer", type: "text", maxlength: String(MAX_REVIEWER), required: "required" });
  const dlgError = el("p", { id: "dlg-error", role: "alert" });
  const submitBtn = el("button", { type: "submit", text: "Save decision" });
  const cancelBtn = el("button", { type: "button", text: "Cancel" });
  const form = el("form", { method: "dialog" }, [
    dlgTitle,
    dlgTarget,
    scopeSet,
    targetWrap,
    matchText,
    el("p", null, [reasonLabel, el("br"), reasonInput]),
    el("p", null, [reviewerLabel, el("br"), reviewerInput]),
    el("p", { text: NOTICE_PUBLIC }),
    el("p", { text: NOTICE_NEXT_RUN }),
    dlgError,
    el("p", null, [submitBtn, " ", cancelBtn]),
  ]);
  targetWrap.appendChild(targetLabel);
  targetWrap.appendChild(document.createTextNode(" "));
  targetWrap.appendChild(targetSelect);
  scopeSet.appendChild(scopeLegend);
  dialog.appendChild(form);
  root.appendChild(dialog);

  let current = null; // { mode, finding, entry, trigger }

  function selectedScope() {
    const checked = scopeSet.querySelector("input[type=radio]:checked");
    return checked ? checked.value : "";
  }

  function updateMatches() {
    if (!current || current.mode === "unignore") {
      matchText.textContent = "";
      return;
    }
    const f = current.finding;
    const scope = selectedScope();
    let n = 1;
    if (scope === "page-rule") n = f.matches["page-rule"];
    else if (scope === "site-rule") n = f.matches["site-rule"];
    matchText.textContent = "This matches " + plural(n, "finding", "findings") + " in this run.";
    const showTarget = scope === "element" && f.nodeTargets.length > 0;
    targetWrap.hidden = !showTarget;
  }

  function addScope(value, label, checked) {
    const id = "dlg-scope-" + value;
    const input = el("input", { type: "radio", name: "scope", id: id, value: value });
    if (checked) input.checked = true;
    input.addEventListener("change", updateMatches);
    scopeSet.appendChild(el("div", null, [input, " ", el("label", { for: id, text: label })]));
  }

  function openDialog(mode, finding, entry, trigger) {
    current = { mode, finding, entry, trigger };
    dlgError.textContent = "";
    reasonInput.value = "";
    reviewerInput.value = readReviewer();
    while (scopeSet.lastChild && scopeSet.lastChild !== scopeLegend) scopeSet.removeChild(scopeSet.lastChild);
    targetSelect.replaceChildren();
    if (mode === "ignore") {
      dlgTitle.textContent = "Ignore this finding";
      dlgTarget.textContent = finding.title + " (" + finding.ruleId + ") on " + finding.pageUrl + ", " + finding.viewport;
      scopeSet.hidden = false;
      addScope("element", "This element only", true);
      addScope("page-rule", "This rule on this page", false);
      addScope("site-rule", "This rule on every page", false);
      for (const t of finding.nodeTargets) targetSelect.appendChild(el("option", { value: t, text: t }));
    } else if (mode === "resolve") {
      dlgTitle.textContent = "Mark as resolved";
      dlgTarget.textContent = finding.title + " (" + finding.ruleId + ") on " + finding.pageUrl + ", " + finding.viewport;
      scopeSet.hidden = true;
    } else {
      dlgTitle.textContent = "Un-ignore";
      dlgTarget.textContent = "Undo the ignore decision: " + entry.reason;
      scopeSet.hidden = true;
    }
    targetWrap.hidden = true;
    updateMatches();
    dialog.showModal();
    (mode === "ignore" ? scopeSet.querySelector("input") : reasonInput).focus();
  }

  function closeDialog() {
    const trigger = current && current.trigger;
    current = null;
    if (dialog.open) dialog.close();
    if (trigger && trigger.isConnected) trigger.focus();
    else root.querySelector("button") && root.querySelector("button").focus();
  }

  dialog.addEventListener("cancel", () => {
    // Escape: let the dialog close, then return focus to the trigger.
    const trigger = current && current.trigger;
    current = null;
    if (trigger && trigger.isConnected) setTimeout(() => trigger.focus(), 0);
  });
  cancelBtn.addEventListener("click", closeDialog);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!current) return;
    const reason = reasonInput.value.trim();
    const reviewer = reviewerInput.value.trim();
    if (reason === "") {
      dlgError.textContent = "Enter a reason.";
      reasonInput.focus();
      return;
    }
    if (reason.length > MAX_REASON) {
      dlgError.textContent = "The reason can be at most 500 characters.";
      reasonInput.focus();
      return;
    }
    if (reviewer === "") {
      dlgError.textContent = "Enter the reviewer name.";
      reviewerInput.focus();
      return;
    }
    if (reviewer.length > MAX_REVIEWER) {
      dlgError.textContent = "The reviewer name can be at most 80 characters.";
      reviewerInput.focus();
      return;
    }
    const f = current.finding;
    let body;
    if (current.mode === "unignore") {
      body = { decision: "unignore", scope: "undo", undoes: current.entry.id, reason, reviewer };
    } else if (current.mode === "resolve") {
      body = {
        decision: "resolve",
        scope: "finding",
        pageUrl: f.pageUrl,
        viewport: f.viewport,
        ruleId: f.ruleId,
        reason,
        reviewer,
      };
    } else {
      const scope = selectedScope() || "element";
      body = { decision: "ignore", scope, pageUrl: f.pageUrl, viewport: f.viewport, ruleId: f.ruleId, reason, reviewer };
      if (scope === "element") body.cssTarget = f.nodeTargets.length > 0 ? targetSelect.value : "";
    }
    submitBtn.disabled = true;
    try {
      await api("/api/dispositions", { body });
      saveReviewer(reviewer);
      closeDialog();
      announce("Decision saved. " + NOTICE_NEXT_RUN, true);
      await load();
    } catch (e) {
      dlgError.textContent = e && e.message ? e.message : "The decision could not be saved.";
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ---- panels -------------------------------------------------------------
  function actionButton(label, onClick) {
    const b = el("button", { type: "button", text: label });
    b.addEventListener("click", () => onClick(b));
    return b;
  }

  function renderFindings() {
    findingsPanel.replaceChildren(el("h3", { id: "findings-h", text: "Findings" }));
    if (!runInfo) {
      findingsPanel.appendChild(el("p", { text: "No local run was found yet, so there are no findings to review." }));
      return;
    }
    findingsPanel.appendChild(
      el("p", { text: "Run " + runInfo.runId + (runInfo.finishedAt ? ", finished " + runInfo.finishedAt : "") + "." }),
    );
    if (findings.length === 0) {
      findingsPanel.appendChild(el("p", { text: "This run has no findings." }));
      return;
    }
    const head = el("tr", null, ["Finding", "Page", "Viewport", "Severity", "Status", "Actions"].map((h) => el("th", { scope: "col", text: h })));
    const body = el("tbody");
    for (const f of findings) {
      const actions = el("td");
      if (f.status === "active") {
        actions.appendChild(actionButton("Mark resolved", (b) => openDialog("resolve", f, null, b)));
        actions.appendChild(document.createTextNode(" "));
        actions.appendChild(actionButton("Ignore", (b) => openDialog("ignore", f, null, b)));
      } else if (f.status === "ignored") {
        const entry = findIgnoreEntry(f, entries);
        if (entry) actions.appendChild(actionButton("Un-ignore", (b) => openDialog("unignore", f, entry, b)));
        else actions.appendChild(document.createTextNode("Ignored by an earlier decision"));
      } else {
        actions.appendChild(document.createTextNode("Decision takes effect next run"));
      }
      const statusText = f.status === "decision-pending" ? "Decision pending" : f.status === "ignored" ? "Ignored" : "Active";
      body.appendChild(
        el("tr", null, [
          el("td", { text: f.title + " (" + f.ruleId + ")" }),
          el("td", { text: f.pageUrl }),
          el("td", { text: f.viewport }),
          el("td", { text: f.severity }),
          el("td", { text: statusText }),
          actions,
        ]),
      );
    }
    const table = el("table", null, [
      el("caption", { text: "Findings in the latest run" }),
      el("thead", null, [head]),
      body,
    ]);
    findingsPanel.appendChild(table);
  }

  function describeScope(e) {
    const m = e.matcher;
    if (e.scope === "undo") return "Undo of " + e.undoes;
    if (e.scope === "site-rule") return "Rule " + m.ruleId + " on every page";
    if (e.scope === "page-rule") return "Rule " + m.ruleId + " on " + m.pageUrl;
    if (e.scope === "element") return "Element" + (m.cssTarget ? " " + m.cssTarget : "") + ", rule " + m.ruleId + " on " + m.pageUrl;
    return "Rule " + m.ruleId + " on " + m.pageUrl + (m.viewport ? ", " + m.viewport : "");
  }

  let syncInfo = { state: "synced", reason: null };
  let syncTimer = null;
  const syncStatus = el("span", { id: "sync-status", role: "status", "aria-live": "polite" });
  const syncBtn = el("button", { type: "button", text: "Sync now" });

  function renderSync() {
    const running = syncInfo.state === "running";
    const failed = syncInfo.state === "not-yet-synced" && !!syncInfo.reason;
    const isSynced = syncInfo.state === "synced" && notYetSynced === 0;
    let text = isSynced ? "Synced" : running ? "Syncing decisions" : "Not yet synced";
    if (!isSynced && !running && notYetSynced > 0) text += " (" + plural(notYetSynced, "decision", "decisions") + ")";
    if (failed) text += ". " + syncInfo.reason;
    syncStatus.textContent = text + " ";
    syncBtn.textContent = failed ? "Retry" : "Sync now";
    syncBtn.disabled = running;
  }

  async function refreshSync() {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    try {
      const s = await api("/api/dispositions/sync/status");
      syncInfo = { state: s.state, reason: s.reason || null };
      if (typeof s.notYetSynced === "number") notYetSynced = s.notYetSynced;
    } catch (e) {
      syncInfo = { state: "not-yet-synced", reason: "The sync state could not be read." };
    }
    renderSync();
    if (syncInfo.state === "running") {
      syncTimer = setTimeout(async () => {
        syncTimer = null;
        await refreshSync();
        if (syncInfo.state !== "running") {
          announce(syncInfo.state === "synced" ? "Decisions synced." : "Not yet synced. " + (syncInfo.reason || ""), true);
          await load();
        }
      }, 1000);
    }
  }

  syncBtn.addEventListener("click", async () => {
    syncBtn.disabled = true;
    try {
      await api("/api/dispositions/sync", { body: {} });
      announce("Sync started.", true);
    } catch (e) {
      // A 409 means a sync is already running; the status call below shows the real state.
    }
    await refreshSync();
  });

  function renderDecisions() {
    decisionsPanel.replaceChildren(el("h3", { id: "decisions-h", text: "Decisions" }));
    decisionsPanel.appendChild(el("p", null, [syncStatus, syncBtn]));
    renderSync();
    if (entries.length === 0) {
      decisionsPanel.appendChild(el("p", { text: "No decisions have been recorded." }));
      return;
    }
    const head = el("tr", null, ["Decision", "Scope", "Reason", "Reviewer", "Date", "Sync"].map((h) => el("th", { scope: "col", text: h })));
    const body = el("tbody");
    for (const e of entries) {
      const label = e.decision === "ignore" ? "Ignore" : e.decision === "resolve" ? "Resolved" : "Un-ignore";
      body.appendChild(
        el("tr", null, [
          el("td", { text: label + (e.undone ? " (undone)" : "") }),
          el("td", { text: describeScope(e) }),
          el("td", { text: e.reason }),
          el("td", { text: e.reviewer }),
          el("td", { text: e.at }),
          el("td", { text: e.syncState === "synced" ? "Synced" : "Not yet synced" }),
        ]),
      );
    }
    decisionsPanel.appendChild(
      el("table", null, [el("caption", { text: "All decisions, including undone ones" }), el("thead", null, [head]), body]),
    );
  }

  async function load() {
    showAlert("");
    try {
      const d = await api("/api/dispositions");
      entries = d.entries || [];
      notYetSynced = d.sync ? d.sync.notYetSynced : 0;
    } catch (e) {
      entries = [];
      showAlert(e && e.message ? e.message : "Decisions could not be loaded.");
    }
    try {
      const r = await api("/api/findings?run=latest");
      runInfo = r.run;
      findings = r.findings || [];
    } catch (e) {
      runInfo = null;
      findings = [];
    }
    renderFindings();
    renderDecisions();
    if (syncInfo.state === "running" || !syncTimer) await refreshSync();
  }

  await load();
}
