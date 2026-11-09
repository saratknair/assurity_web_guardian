// Domain: shows the guarded site and runs the four-step "Set up a new site" flow.
// Nothing here changes the monitored site until the final Confirm. Text is set with textContent only.
import { stepLabel, usedText } from "/assets/lib/shell.js";

const REVIEWER_KEY = "awg.reviewer";
const MAX_REVIEWER = 80;
const POLL_MS = 1000;
const TRUST_TEXT =
  "This is a trust decision. The new site is not checked against any allow-list. Your name and the site name are recorded in the audit log. The console will only check that the name looks like a public website.";
const UNCHANGED_TEXT =
  "The current site's configuration stays completely unchanged until the final confirm. Cancelling discards the draft and leaves the current site unchanged.";
const NEEDS_NAME_TEXT = "Enter your name as Reviewer first.";
const JOB_KINDS = ["discovery", "spec-drafts", "visual-capture"];

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

function jobText(job) {
  const secs = Math.floor((Number.isFinite(job.elapsedMs) ? job.elapsedMs : 0) / 1000);
  const what =
    job.kind === "discovery" ? "Finding pages" : job.kind === "spec-drafts" ? "Writing drafts" : "Capturing screenshots";
  const p = job.progress;
  if (p && typeof p === "object" && Number.isFinite(p.total) && p.total > 0) {
    return what + ": " + p.done + " of " + p.total + " done. " + secs + " seconds so far.";
  }
  return what + ". " + secs + " seconds so far.";
}

export async function render(root, ctx) {
  const { el, api, announce, showAlert } = ctx;
  let state = null;
  let active = 1;
  let polling = false;
  let timer = null;
  let busyButtons = [];

  const errorBox = el("p", { role: "alert", class: "error-text" });
  function setError(message) {
    errorBox.textContent = message || "";
    showAlert(message || "");
  }
  function fail(e, fallback) {
    setError(e && e.message ? e.message : fallback);
  }

  // ---- current domain (always shown) ----------------------------------------
  const currentBox = el("p", { "aria-live": "polite" });
  const noticeBox = el("p", { role: "status" });
  root.appendChild(el("h3", { id: "dom-current-h", text: "Monitored site" }));
  root.appendChild(currentBox);
  root.appendChild(noticeBox);
  root.appendChild(errorBox);

  // ---- reviewer ----------------------------------------------------------------
  const reviewerInput = el("input", {
    id: "dom-reviewer",
    type: "text",
    maxlength: String(MAX_REVIEWER),
    autocomplete: "name",
    "aria-describedby": "dom-reviewer-help",
  });
  reviewerInput.value = readReviewer();
  reviewerInput.addEventListener("change", () => saveReviewer(reviewerInput.value.trim()));
  root.appendChild(
    el("p", null, [
      el("label", { for: "dom-reviewer", text: "Reviewer name " }),
      reviewerInput,
      el("span", { id: "dom-reviewer-help", text: " Required. It is recorded in the audit log." }),
    ]),
  );
  function reviewerName() {
    const name = reviewerInput.value.trim();
    if (name) saveReviewer(name);
    return name;
  }
  function needReviewer() {
    const name = reviewerName();
    if (!name) {
      setError(NEEDS_NAME_TEXT);
      reviewerInput.focus();
    }
    return name;
  }

  // ---- flow containers ------------------------------------------------------------
  const flowHost = el("div");
  root.appendChild(flowHost);

  // ---- polling (shared by Find pages, drafts and capture) -------------------------
  const progressBox = el("p", { role: "status" });
  let onJobDone = null;

  function stopPolling() {
    polling = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
  function setBusy(busy) {
    for (const b of busyButtons) b.disabled = busy;
  }
  async function pollOnce() {
    timer = null;
    if (!polling) return;
    if (!root.isConnected) {
      stopPolling();
      return;
    }
    let job = null;
    try {
      job = await api("/api/jobs/status");
    } catch (e) {
      stopPolling();
      setBusy(false);
      fail(e, "The job status could not be read.");
      return;
    }
    if (!polling) return;
    if (job && job.state === "running") {
      if (JOB_KINDS.includes(job.kind)) {
        progressBox.textContent = jobText(job);
        announce(jobText(job), false);
      } else {
        progressBox.textContent = "Another job (" + (job.kind || "unknown") + ") is running. Please wait.";
      }
      timer = setTimeout(pollOnce, POLL_MS);
      return;
    }
    stopPolling();
    progressBox.textContent = "";
    setBusy(false);
    announce("The job ended. The lists are up to date.", true);
    if (onJobDone) {
      try {
        await onJobDone();
      } catch (e) {
        fail(e, "The results could not be read.");
      }
    }
  }
  function startPolling(done) {
    onJobDone = done;
    if (polling) return;
    polling = true;
    setBusy(true);
    timer = setTimeout(pollOnce, POLL_MS);
  }
  async function startJob(path, startedText, done) {
    setError("");
    setBusy(true);
    try {
      await api(path, { body: { scope: "draft" } });
    } catch (e) {
      setBusy(false);
      fail(e, "The job could not be started.");
      return;
    }
    progressBox.textContent = startedText;
    announce(startedText + " This runs on this computer only.", true);
    startPolling(done);
  }

  // ---- state ----------------------------------------------------------------------------
  function drawCurrent() {
    const cur = state && state.currentDomain ? state.currentDomain : "unknown";
    currentBox.textContent = "The Guardian currently monitors: " + cur + ".";
    if (state && state.discarded) {
      noticeBox.textContent =
        state.message || "An unfinished setup was older than 7 days, so it was discarded. Nothing about the current site changed.";
    }
  }

  async function refresh(keepStep) {
    state = await api("/api/domain/setup");
    drawCurrent();
    if (!keepStep) {
      active = 1;
      if (state.draft) {
        const firstOpen = state.steps.findIndex((s) => !s.complete);
        active = firstOpen === -1 ? 4 : Math.min(firstOpen + 1, 4);
      }
    }
    drawFlow();
  }

  // ---- flow drawing ------------------------------------------------------------------------
  function drawFlow() {
    stopPolling();
    busyButtons = [];
    flowHost.replaceChildren();
    flowHost.appendChild(el("h3", { id: "dom-flow-h", text: "Set up a new site" }));
    if (!state.draft) {
      drawStart();
      return;
    }
    flowHost.appendChild(
      el("p", { text: "Setting up: " + state.draft.host + ". It is a draft only. The current site is unchanged." }),
    );
    const list = el("ol", { "aria-label": "Setup steps" });
    for (let n = 1; n <= 4; n++) {
      const li = el("li", { text: stepLabel(n) + (n < 4 && stepDone(n) ? " (done)" : "") });
      if (n === active) li.setAttribute("aria-current", "step");
      list.appendChild(li);
    }
    flowHost.appendChild(list);
    const nav = el("p");
    for (let n = 1; n <= 4; n++) {
      if (n === 1) continue;
      const b = el("button", { type: "button", text: "Go to " + stepLabel(n) });
      b.addEventListener("click", () => {
        active = n;
        setError("");
        drawFlow();
        focusHeading();
      });
      nav.appendChild(b);
      nav.appendChild(document.createTextNode(" "));
    }
    flowHost.appendChild(nav);
    const body = el("div");
    flowHost.appendChild(el("h4", { id: "dom-step-h", tabindex: "-1", text: stepLabel(active) }));
    flowHost.appendChild(body);
    flowHost.appendChild(progressBox);
    if (active === 1) drawStep1Done(body);
    else if (active === 2) drawStep2(body);
    else if (active === 3) drawStep3(body);
    else drawStep4(body);
    flowHost.appendChild(el("hr"));
    drawCancel();
  }

  function focusHeading() {
    const h = document.getElementById("dom-step-h");
    if (h) h.focus();
  }

  function stepDone(n) {
    if (n === 1) return true;
    const s = state.steps[n - 1];
    return !!(s && s.complete);
  }

  function drawCancel() {
    const btn = el("button", { type: "button", text: "Cancel setup" });
    btn.addEventListener("click", async () => {
      const reviewer = needReviewer();
      if (!reviewer) return;
      setError("");
      btn.disabled = true;
      try {
        await api("/api/domain/setup/cancel", { body: { reviewer } });
        noticeBox.textContent = "Setup cancelled. The draft was discarded and the current site is unchanged.";
        announce("Setup cancelled. The current site is unchanged.", true);
        await refresh(false);
      } catch (e) {
        btn.disabled = false;
        fail(e, "The setup could not be cancelled.");
      }
    });
    flowHost.appendChild(el("p", null, [btn, " Cancel discards the draft and leaves the current site unchanged."]));
  }

  // ---- step 1 ------------------------------------------------------------------------
  function drawStart() {
    flowHost.appendChild(el("h4", { id: "dom-step-h", tabindex: "-1", text: stepLabel(1) }));
    const list = el("ol", { "aria-label": "Setup steps" });
    for (let n = 1; n <= 4; n++) {
      const li = el("li", { text: stepLabel(n) });
      if (n === 1) li.setAttribute("aria-current", "step");
      list.appendChild(li);
    }
    flowHost.appendChild(list);
    flowHost.appendChild(el("p", { text: TRUST_TEXT }));
    flowHost.appendChild(el("p", { text: UNCHANGED_TEXT }));
    const host = el("input", { id: "dom-host", type: "text", autocomplete: "off", size: "40", spellcheck: "false" });
    const again = el("input", { id: "dom-host2", type: "text", autocomplete: "off", size: "40", spellcheck: "false" });
    const go = el("button", { type: "submit", class: "primary", text: "Start setup" });
    const form = el("form", { "aria-labelledby": "dom-step-h" }, [
      el("p", null, [el("label", { for: "dom-host", text: "New site name (for example www.example.com) " }), host]),
      el("p", null, [el("label", { for: "dom-host2", text: "Type the site name again " }), again]),
      el("p", null, [go]),
    ]);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const h = host.value.trim();
      if (!h) {
        setError("Enter the new site name.");
        host.focus();
        return;
      }
      if (h !== again.value.trim()) {
        setError("The two site names do not match.");
        again.focus();
        return;
      }
      const reviewer = needReviewer();
      if (!reviewer) return;
      setError("");
      go.disabled = true;
      try {
        await api("/api/domain/setup/start", { body: { host: h, retypedHost: again.value.trim(), reviewer } });
        noticeBox.textContent = "";
        announce("Setup started for " + h + ". The current site is unchanged.", true);
        await refresh(false);
        active = 2;
        drawFlow();
        focusHeading();
      } catch (e) {
        go.disabled = false;
        fail(e, "The setup could not be started.");
        host.focus();
      }
    });
    flowHost.appendChild(form);
  }

  function drawStep1Done(body) {
    body.appendChild(el("p", { text: "The new site name is " + state.draft.host + ". It was entered by " + (state.draft.reviewer || "a reviewer") + " and recorded in the audit log." }));
    body.appendChild(el("p", { text: "To use a different name, cancel the setup and start again." }));
  }

  // ---- step 2 --------------------------------------------------------------------------
  function drawStep2(body) {
    const step = state.steps[1] || {};
    const usedBox = el("p", { "aria-live": "polite", text: usedText(step.count, step.max) + "." });
    body.appendChild(usedBox);
    for (const r of step.reasons || []) body.appendChild(el("p", { text: r }));

    const listHost = el("div");
    const addInput = el("input", { id: "dom-add", type: "text", autocomplete: "off", size: "60" });
    const addBtn = el("button", { type: "submit", text: "Add address" });
    const form = el("form", null, [
      el("label", { for: "dom-add", text: "Web address for the new site " }),
      addInput,
      addBtn,
    ]);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const url = addInput.value.trim();
      if (!url) {
        setError("Enter a web address.");
        addInput.focus();
        return;
      }
      const reviewer = needReviewer();
      if (!reviewer) return;
      setError("");
      addBtn.disabled = true;
      try {
        const res = await api("/api/urls/add", { body: { scope: "draft", url, reviewer } });
        const results = Array.isArray(res.results) ? res.results : [];
        const bad = results.filter((r) => r.status !== "added");
        if (bad.length > 0) setError(bad.map((r) => (r.input || url) + ": " + (r.reason || r.status)).join(" "));
        else addInput.value = "";
        announce("Page list updated. " + (res.usedText || ""), true);
        await reload();
      } catch (e) {
        fail(e, "The address could not be added.");
      } finally {
        addBtn.disabled = false;
        addInput.focus();
      }
    });
    body.appendChild(form);

    const findBtn = el("button", { type: "button", class: "primary", text: "Find pages" });
    busyButtons.push(findBtn);
    findBtn.addEventListener("click", () =>
      startJob("/api/discovery/run", "Finding pages. Starting.", async () => {
        await loadCandidates();
        findBtn.focus();
      }),
    );
    body.appendChild(el("p", null, [findBtn, " Find pages checks the new site on this computer only."]));

    const candHost = el("div");
    body.appendChild(candHost);
    body.appendChild(el("h5", { text: "Pages in the draft list" }));
    body.appendChild(listHost);

    async function reload() {
      state = await api("/api/domain/setup");
      if (!state.draft) {
        await refresh(false);
        return;
      }
      const s = state.steps[1] || {};
      usedBox.textContent = usedText(s.count, s.max) + ".";
      await drawList();
      await loadCandidates();
    }

    async function drawList() {
      const data = await api("/api/urls?scope=draft");
      listHost.replaceChildren();
      const urls = Array.isArray(data.urls) ? data.urls : [];
      if (urls.length === 0) {
        listHost.appendChild(el("p", { text: "No pages added yet." }));
        return;
      }
      const body2 = el("tbody");
      for (const u of urls) body2.appendChild(el("tr", null, [el("td", { text: u.url })]));
      listHost.appendChild(
        el("table", null, [
          el("caption", { text: "Draft pages (" + (data.usedText || "") + ")" }),
          el("thead", null, [el("tr", null, [el("th", { scope: "col", text: "Web address" })])]),
          body2,
        ]),
      );
    }

    let boxes = [];
    async function loadCandidates() {
      let data;
      try {
        data = await api("/api/discovery/candidates?scope=draft");
      } catch (e) {
        candHost.replaceChildren();
        return;
      }
      candHost.replaceChildren();
      boxes = [];
      const list = Array.isArray(data.candidates) ? data.candidates : [];
      if (data.outcome) candHost.appendChild(el("p", { text: data.outcome }));
      const rows = el("tbody");
      list.forEach((c, i) => {
        let cell;
        let status;
        if (c.approvable) {
          const box = el("input", { type: "checkbox", id: "dom-pick-" + i, "aria-label": "Select " + c.url });
          box.dataset.url = c.url;
          boxes.push(box);
          cell = el("td", null, [box]);
          status = "Not yet in the list";
        } else {
          cell = el("td", { text: "-" });
          status = c.alreadyApproved ? "Already in the list" : "Cannot be added: " + (c.reason || "not suitable");
        }
        rows.appendChild(el("tr", null, [cell, el("td", { text: c.url }), el("td", { text: c.title || c.h1 || "" }), el("td", { text: status })]));
      });
      if (data.state !== "ready" || list.length === 0) return;
      candHost.appendChild(
        el("table", null, [
          el("caption", { text: "Pages found for " + (data.domain || state.draft.host) }),
          el("thead", null, [
            el("tr", null, [
              el("th", { scope: "col", text: "Select" }),
              el("th", { scope: "col", text: "Web address" }),
              el("th", { scope: "col", text: "Title" }),
              el("th", { scope: "col", text: "Status" }),
            ]),
          ]),
          rows,
        ]),
      );
      const approve = el("button", { type: "button", text: "Add selected pages" });
      approve.addEventListener("click", async () => {
        const urls = boxes.filter((b) => b.checked).map((b) => b.dataset.url);
        if (urls.length === 0) {
          setError("Select at least one page.");
          return;
        }
        const reviewer = needReviewer();
        if (!reviewer) return;
        setError("");
        approve.disabled = true;
        try {
          const res = await api("/api/discovery/approve", { body: { scope: "draft", urls, reviewer } });
          announce(plural(res.approved || 0, "page", "pages") + " added to the draft list.", true);
          await reload();
        } catch (e) {
          approve.disabled = false;
          fail(e, "The pages could not be added.");
        }
      });
      candHost.appendChild(el("p", null, [approve]));
    }

    drawList().catch((e) => fail(e, "The page list could not be read."));
    loadCandidates();
  }

  // ---- step 3 --------------------------------------------------------------------------
  function drawStep3(body) {
    const step = state.steps[2] || {};
    for (const r of step.reasons || []) body.appendChild(el("p", { text: r }));
    body.appendChild(
      el("p", {
        text: "Drafting and capturing run on this computer only. Approve each item you have reviewed. Screenshots taken on Windows may differ slightly from the cloud runner.",
      }),
    );
    const statusHost = el("div");
    const draftsHost = el("div");
    const capsHost = el("div");
    const resultBox = el("div", { role: "status" });
    const draftBtn = el("button", { type: "button", text: "Write spec drafts" });
    const capBtn = el("button", { type: "button", text: "Capture screenshots" });
    busyButtons.push(draftBtn, capBtn);
    draftBtn.addEventListener("click", () => startJob("/api/baselines/spec/draft", "Writing drafts. Starting.", loadAll));
    capBtn.addEventListener("click", () =>
      startJob("/api/baselines/visual/capture", "Capturing screenshots. Starting.", loadAll),
    );
    body.appendChild(el("p", null, [draftBtn, " ", capBtn]));
    body.appendChild(statusHost);
    body.appendChild(draftsHost);
    body.appendChild(capsHost);
    body.appendChild(resultBox);

    async function approveItems(specs, visuals, button) {
      const reviewer = needReviewer();
      if (!reviewer) return;
      setError("");
      button.disabled = true;
      try {
        const res = await api("/api/baselines/approve", { body: { scope: "draft", reviewer, specs, visuals } });
        const msg = "Approved " + res.promoted + ", unchanged " + res.unchanged + ", refused " + res.refused + ".";
        announce(msg, true);
        const lines = (Array.isArray(res.results) ? res.results : [])
          .filter((r) => r.status !== "promoted" && r.reason)
          .map((r) => (r.slug || "item") + ": " + r.reason);
        await loadAll();
        resultBox.replaceChildren(el("p", { text: msg + (lines.length ? " " + lines.join(" ") : "") }));
      } catch (e) {
        button.disabled = false;
        fail(e, "The item could not be approved.");
      }
    }

    function image(kind, slug, viewport, id, alt, caption) {
      let q = "/api/baselines/image?kind=" + kind + "&scope=draft&slug=" + encodeURIComponent(slug);
      q += "&viewport=" + encodeURIComponent(viewport);
      if (id) q += "&id=" + encodeURIComponent(id);
      return el("figure", null, [el("img", { src: q, alt, loading: "lazy", width: "320" }), el("figcaption", { text: caption })]);
    }

    async function loadAll() {
      const [data, props, setup] = await Promise.all([
        api("/api/baselines?scope=draft"),
        api("/api/baselines/proposals?scope=draft"),
        api("/api/domain/setup"),
      ]);
      state = setup;
      statusHost.replaceChildren();
      const urls = Array.isArray(data.urls) ? data.urls : [];
      if (urls.length === 0) {
        statusHost.appendChild(el("p", { text: "There are no pages in the draft list yet. Go back to step 2." }));
      } else {
        const rows = el("tbody");
        for (const u of urls) {
          const vb = u.visualBaseline || {};
          rows.appendChild(
            el("tr", null, [
              el("td", { text: u.url }),
              el("td", { text: u.specBaseline ? "Yes" : "No" }),
              el("td", { text: vb.desktop ? "Yes" : "No" }),
              el("td", { text: vb.mobile ? "Yes" : "No" }),
              el("td", { text: u.ready ? "Ready" : "Not ready" }),
            ]),
          );
        }
        statusHost.appendChild(
          el("table", null, [
            el("caption", { text: "Baseline readiness per draft page" }),
            el("thead", null, [
              el("tr", null, [
                el("th", { scope: "col", text: "Web address" }),
                el("th", { scope: "col", text: "Spec baseline approved" }),
                el("th", { scope: "col", text: "Desktop screenshot approved" }),
                el("th", { scope: "col", text: "Mobile screenshot approved" }),
                el("th", { scope: "col", text: "Ready" }),
              ]),
            ]),
            rows,
          ]),
        );
      }
      draftsHost.replaceChildren(el("h5", { text: "Proposed spec drafts" }));
      const drafts = Array.isArray(props.drafts) ? props.drafts : [];
      if (drafts.length === 0) draftsHost.appendChild(el("p", { text: "There are no spec drafts waiting for review." }));
      for (const d of drafts) {
        const btn = el("button", { type: "button", text: "Approve", "aria-label": "Approve spec draft for " + d.slug });
        btn.addEventListener("click", () => approveItems([d.slug], [], btn));
        draftsHost.appendChild(
          el("div", { class: "panel" }, [
            el("p", { text: "Spec draft for " + d.slug + (d.truncated ? " (shown shortened)" : "") }),
            el("pre", {
              role: "region",
              tabindex: "0",
              class: "scroll-region",
              "aria-label": "Spec draft text for " + d.slug,
              text: d.text || "",
            }),
            el("p", null, [btn]),
          ]),
        );
      }
      capsHost.replaceChildren(el("h5", { text: "Proposed screenshots" }));
      const caps = Array.isArray(props.captures) ? props.captures : [];
      if (caps.length === 0) capsHost.appendChild(el("p", { text: "There are no captured screenshots waiting for review." }));
      for (const c of caps) {
        capsHost.appendChild(el("p", { text: "Capture " + c.captureId + (c.createdAt ? " (taken " + c.createdAt + ")" : "") }));
        for (const f of Array.isArray(c.failures) ? c.failures : []) {
          capsHost.appendChild(el("p", { text: "Failed: " + f.slug + " " + f.viewport + ". " + f.reason }));
        }
        for (const e of Array.isArray(c.entries) ? c.entries : []) {
          const label = (e.url || e.slug) + ", " + e.viewport;
          const btn = el("button", { type: "button", text: "Approve", "aria-label": "Approve " + e.viewport + " screenshot of " + (e.url || e.slug) });
          btn.addEventListener("click", () =>
            approveItems([], [{ captureId: c.captureId, slug: e.slug, viewport: e.viewport }], btn),
          );
          capsHost.appendChild(
            el("div", { class: "panel" }, [
              el("p", { text: label }),
              el("details", null, [
                el("summary", { text: "Show screenshot for " + label }),
                image("proposal", e.slug, e.viewport, c.captureId, "Proposed screenshot, " + e.viewport + " viewport, page " + (e.url || e.slug), "Proposed screenshot"),
              ]),
              el("p", null, [btn]),
            ]),
          );
        }
      }
    }

    loadAll().catch((e) => fail(e, "The baselines could not be read."));
    api("/api/jobs/status")
      .then((job) => {
        if (job && job.state === "running" && JOB_KINDS.includes(job.kind)) {
          progressBox.textContent = jobText(job);
          startPolling(loadAll);
        }
      })
      .catch(() => {});
  }

  // ---- step 4 --------------------------------------------------------------------------
  function drawStep4(body) {
    const host = state.draft.host;
    body.appendChild(el("p", { text: "Switching to " + host + " will change what the Guardian monitors, from " + (state.currentDomain || "the current site") + " to " + host + "." }));
    body.appendChild(el("h5", { text: "Readiness" }));
    if (state.canConfirm) {
      body.appendChild(el("p", { text: "Everything is ready. You can confirm." }));
    } else {
      body.appendChild(el("p", { text: "Not ready yet. Still missing:" }));
      const ul = el("ul");
      for (const r of state.reasons || []) ul.appendChild(el("li", { text: r }));
      body.appendChild(ul);
    }
    const retype = el("input", { id: "dom-confirm-host", type: "text", autocomplete: "off", size: "40", spellcheck: "false" });
    const check = el("input", { type: "checkbox", id: "dom-confirm-check" });
    const go = el("button", { type: "button", text: "Confirm and switch site" });
    const result = el("div", { role: "status" });
    function update() {
      go.disabled = !(state.canConfirm && check.checked && retype.value.trim() !== "");
    }
    retype.addEventListener("input", update);
    check.addEventListener("change", update);
    body.appendChild(el("p", null, [el("label", { for: "dom-confirm-host", text: "Type the new site name (" + host + ") to confirm " }), retype]));
    body.appendChild(
      el("p", null, [
        check,
        " ",
        el("label", { for: "dom-confirm-check", text: "I understand this switches what is monitored to " + host + "." }),
      ]),
    );
    body.appendChild(el("p", null, [go]));
    body.appendChild(result);
    update();
    go.addEventListener("click", async () => {
      const reviewer = needReviewer();
      if (!reviewer) return;
      setError("");
      go.disabled = true;
      try {
        const res = await api("/api/domain/setup/confirm", {
          body: { reviewer, retypedHost: retype.value.trim(), confirm: true },
        });
        const msg = res.message || "The monitored site is now " + host + ".";
        announce(msg, true);
        state = await api("/api/domain/setup");
        drawCurrent();
        flowHost.replaceChildren();
        flowHost.appendChild(el("h3", { id: "dom-flow-h", text: "Set up a new site" }));
        flowHost.appendChild(el("p", { role: "status", text: msg }));
        flowHost.appendChild(
          el("p", {
            text: "The change is saved in this folder only. It takes effect on GitHub after you press Publish.",
          }),
        );
        flowHost.appendChild(
          el("p", {
            text: "History from the old site stays visible and is labelled Different site.",
          }),
        );
        flowHost.appendChild(el("p", null, [el("a", { href: "#publish", text: "Go to Publish" })]));
      } catch (e) {
        update();
        fail(e, "The site could not be switched.");
      }
    });
  }

  window.addEventListener("hashchange", stopPolling, { once: true });

  try {
    await refresh(false);
  } catch (e) {
    fail(e, "The setup state could not be read.");
  }
}
