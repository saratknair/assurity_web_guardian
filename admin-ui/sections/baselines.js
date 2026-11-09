// Baselines: write spec drafts and capture screenshots on this computer, then approve chosen items.
// Text is set with textContent only. Status is always stated in words, never by colour alone.

const REVIEWER_KEY = "awg.reviewer";
const MAX_REVIEWER = 80;
const POLL_MS = 1000;
const SCOPE = "current";
const LOCAL_TEXT =
  "Drafting and capturing run on this computer only. A capture is not a monitoring run. It will not appear in the Dashboard or the Virtual Office, and nothing is pushed or published.";
const PLATFORM_TEXT =
  "Screenshots taken on Windows may differ slightly from the Linux cloud runner (fonts and rendering). The first cloud run may therefore show visual differences. After a cloud run, you can choose to use its screenshots as baselines (see the end of this page).";
const CLOUD_TEXT =
  "This replaces your laptop screenshot with the one the cloud runner took, which is what future cloud runs compare against. Pull runs first with the Runs and logs section. Only the screenshots you select are used, and your Reviewer name is recorded.";
const GROWTH_TEXT =
  "Each approved screenshot is a PNG of about 1.5 MB that is stored in the repository in the baselines-visual folder. Approving many screenshots, or replacing them often, makes the repository grow.";
const NEEDS_NAME_TEXT = "Enter your name as Reviewer first.";

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

function yesNo(v) {
  return v ? "Yes" : "No";
}

function imageUrl(kind, slug, viewport, id) {
  let q = "/api/baselines/image?kind=" + kind + "&scope=" + SCOPE + "&slug=" + encodeURIComponent(slug);
  q += "&viewport=" + encodeURIComponent(viewport);
  if (id) q += "&id=" + encodeURIComponent(id);
  return q;
}

function jobText(job) {
  const secs = Math.floor((Number.isFinite(job.elapsedMs) ? job.elapsedMs : 0) / 1000);
  const what = job.kind === "spec-drafts" ? "Writing drafts" : "Capturing screenshots";
  let text = what + ". " + secs + " seconds so far.";
  const p = job.progress;
  if (p && typeof p === "object" && Number.isFinite(p.total) && p.total > 0) {
    text = what + ": " + p.done + " of " + p.total + " done. " + secs + " seconds so far.";
  }
  return text;
}

export async function render(root, ctx) {
  const { el, api, announce, showAlert } = ctx;
  let polling = false;
  let timer = null;
  let draftBoxes = [];
  let visualBoxes = [];

  root.appendChild(el("p", { text: LOCAL_TEXT }));
  root.appendChild(el("p", { text: PLATFORM_TEXT }));

  const errorBox = el("p", { role: "alert", class: "error-text" });
  function setError(message) {
    errorBox.textContent = message || "";
    showAlert(message || "");
  }
  root.appendChild(errorBox);

  // ---- reviewer ---------------------------------------------------------------
  const reviewerInput = el("input", {
    id: "bl-reviewer",
    type: "text",
    maxlength: String(MAX_REVIEWER),
    autocomplete: "name",
    "aria-describedby": "bl-reviewer-help",
  });
  reviewerInput.value = readReviewer();
  reviewerInput.addEventListener("change", () => saveReviewer(reviewerInput.value.trim()));
  root.appendChild(
    el("p", null, [
      el("label", { for: "bl-reviewer", text: "Reviewer name " }),
      reviewerInput,
      el("span", {
        id: "bl-reviewer-help",
        text: " Required to approve. It is recorded in the setup activity log.",
      }),
    ]),
  );

  function reviewerName() {
    const name = reviewerInput.value.trim();
    if (name) saveReviewer(name);
    return name;
  }

  // ---- summary and run controls ---------------------------------------------------
  const sizeBox = el("p", { "aria-live": "polite" });
  const draftButton = el("button", { type: "button", text: "Write spec drafts" });
  const captureButton = el("button", { type: "button", class: "primary", text: "Capture screenshots" });
  const progressBox = el("p", { role: "status" });
  const statusHost = el("div");
  const draftsHost = el("div");
  const capturesHost = el("div");
  const resultBox = el("div", { role: "status" });
  root.appendChild(sizeBox);
  root.appendChild(el("p", { text: GROWTH_TEXT }));
  root.appendChild(el("p", null, [draftButton, " ", captureButton]));
  root.appendChild(progressBox);
  root.appendChild(statusHost);
  root.appendChild(draftsHost);
  root.appendChild(capturesHost);

  const approveButton = el("button", { type: "button", text: "Approve selected" });
  const selectedCount = el("span", { "aria-live": "polite" });
  root.appendChild(el("p", null, [approveButton, selectedCount]));
  root.appendChild(resultBox);

  // ---- use the cloud run's screenshots ----------------------------------------------------
  const cloudHost = el("div");
  const cloudButton = el("button", {
    type: "button",
    text: "Use the cloud run's screenshots",
    "aria-describedby": "bl-cloud-note",
  });
  const cloudNote = el("p", { id: "bl-cloud-note", "aria-live": "polite" });
  const cloudResult = el("div", { role: "status" });
  let cloudBoxes = [];
  let cloudRunId = "";
  root.appendChild(el("h3", { id: "bl-cloud-h", text: "Use the cloud run's screenshots" }));
  root.appendChild(el("p", { text: CLOUD_TEXT }));
  root.appendChild(cloudHost);
  root.appendChild(el("p", null, [cloudButton]));
  root.appendChild(cloudNote);
  root.appendChild(cloudResult);

  function updateCloud() {
    const n = cloudBoxes.filter((b) => b.checked).length;
    cloudButton.disabled = cloudBoxes.length === 0 || n === 0;
    if (cloudBoxes.length === 0) {
      cloudNote.textContent =
        "Not available yet. No cloud run has been pulled. Pull runs first with the Runs and logs section.";
    } else if (n === 0) {
      cloudNote.textContent = "Select at least one screenshot to use.";
    } else {
      cloudNote.textContent = plural(n, "screenshot", "screenshots") + " selected.";
    }
  }

  function drawCloud(runs) {
    cloudHost.replaceChildren();
    cloudBoxes = [];
    cloudRunId = "";
    const run = runs.find((r) => Array.isArray(r.items) && r.items.length > 0);
    if (!run) {
      cloudHost.appendChild(el("p", { text: "No pulled cloud run has screenshots for your approved web addresses." }));
      updateCloud();
      return;
    }
    cloudRunId = run.runId;
    cloudHost.appendChild(el("h4", { text: "Cloud run " + run.runId + (run.finishedAt ? " (finished " + run.finishedAt + ")" : "") }));
    run.items.forEach((e, idx) => {
      const box = el("input", {
        type: "checkbox",
        id: "bl-cloud-" + idx,
        "aria-label": "Select " + e.viewport + " cloud screenshot of " + (e.url || e.slug),
      });
      box.dataset.slug = e.slug;
      box.dataset.viewport = e.viewport;
      box.dataset.sha16 = e.sha16;
      box.addEventListener("change", updateCloud);
      cloudBoxes.push(box);
      const label = (e.url || e.slug) + ", " + e.viewport;
      const parts = [];
      if (e.hasBaseline) {
        parts.push(
          figure(
            imageUrl("baseline", e.slug, e.viewport, ""),
            "Current approved baseline, " + e.viewport + " viewport, page " + (e.url || e.slug),
            "Current baseline (replaced if you use the cloud screenshot)",
          ),
        );
      } else {
        parts.push(el("p", { text: "No current baseline exists for this page and viewport." }));
      }
      parts.push(
        figure(
          imageUrl("cloud", e.slug, e.viewport, run.runId),
          "Cloud runner screenshot, " + e.viewport + " viewport, page " + (e.url || e.slug),
          "Cloud runner screenshot",
        ),
      );
      cloudHost.appendChild(
        el("div", { class: "panel" }, [
          el("p", null, [box, " ", el("label", { for: "bl-cloud-" + idx, text: label })]),
          el("details", null, [
            el("summary", { text: "Show screenshots for " + label }),
            el("div", { class: "side-by-side" }, parts),
          ]),
        ]),
      );
    });
    updateCloud();
  }

  cloudButton.addEventListener("click", async () => {
    const items = cloudBoxes
      .filter((b) => b.checked)
      .map((b) => ({ slug: b.dataset.slug, viewport: b.dataset.viewport, sha16: b.dataset.sha16 }));
    if (items.length === 0 || !cloudRunId) {
      setError("Select at least one screenshot.");
      return;
    }
    const reviewer = reviewerName();
    if (!reviewer) {
      setError(NEEDS_NAME_TEXT);
      reviewerInput.focus();
      return;
    }
    setError("");
    cloudButton.disabled = true;
    try {
      const res = await api("/api/baselines/adopt-cloud", { body: { reviewer, runId: cloudRunId, items } });
      const msg = "Used " + res.promoted + ", unchanged " + res.unchanged + ", refused " + res.refused + ".";
      announce(msg, true);
      await loadAll();
      cloudResult.replaceChildren(el("p", { text: msg }));
      const ul = el("ul");
      for (const r of Array.isArray(res.results) ? res.results : []) ul.appendChild(el("li", { text: resultLine(r) }));
      cloudResult.appendChild(ul);
    } catch (e) {
      setError(e && e.message ? e.message : "The screenshots could not be used.");
      updateCloud();
    }
  });

  function updateSelected() {
    const n = draftBoxes.filter((b) => b.checked).length + visualBoxes.filter((b) => b.checked).length;
    selectedCount.textContent = " " + plural(n, "item", "items") + " selected.";
    approveButton.disabled = n === 0;
  }

  // ---- readiness table ----------------------------------------------------------------
  function drawStatus(data) {
    statusHost.replaceChildren();
    sizeBox.textContent = "Size of the baselines-visual folder: " + (data.visualBaselinesSizeText || "unknown") + ".";
    const urls = Array.isArray(data.urls) ? data.urls : [];
    if (urls.length === 0) {
      statusHost.appendChild(el("p", { text: "There are no approved web addresses yet." }));
      return;
    }
    const head = el("tr", null, [
      el("th", { scope: "col", text: "Web address" }),
      el("th", { scope: "col", text: "Spec baseline approved" }),
      el("th", { scope: "col", text: "Desktop screenshot approved" }),
      el("th", { scope: "col", text: "Mobile screenshot approved" }),
      el("th", { scope: "col", text: "Ready" }),
    ]);
    const body = el("tbody");
    for (const u of urls) {
      const vb = u.visualBaseline || {};
      body.appendChild(
        el("tr", null, [
          el("td", { text: u.url }),
          el("td", { text: yesNo(u.specBaseline) }),
          el("td", { text: yesNo(vb.desktop) }),
          el("td", { text: yesNo(vb.mobile) }),
          el("td", { text: u.ready ? "Ready" : "Not ready" }),
        ]),
      );
    }
    statusHost.appendChild(
      el("table", null, [el("caption", { text: "Baseline readiness per web address" }), el("thead", null, [head]), body]),
    );
  }

  // ---- proposals ----------------------------------------------------------------------
  function drawDrafts(drafts) {
    draftsHost.replaceChildren();
    draftBoxes = [];
    draftsHost.appendChild(el("h3", { id: "bl-drafts-h", text: "Proposed spec drafts" }));
    if (drafts.length === 0) {
      draftsHost.appendChild(el("p", { text: "There are no spec drafts waiting for review." }));
      return;
    }
    drafts.forEach((d, i) => {
      const box = el("input", {
        type: "checkbox",
        id: "bl-draft-" + i,
        "aria-label": "Select spec draft for " + d.slug,
      });
      box.dataset.slug = d.slug;
      box.addEventListener("change", updateSelected);
      draftBoxes.push(box);
      const note = d.hasBaseline ? "A baseline exists. Approving saves a new version." : "No baseline yet.";
      const textId = "bl-draft-text-" + i;
      const region = el("pre", {
        id: textId,
        role: "region",
        tabindex: "0",
        class: "scroll-region",
        "aria-label": "Spec draft text for " + d.slug,
        text: d.text || "",
      });
      draftsHost.appendChild(
        el("div", { class: "panel" }, [
          el("p", null, [box, " ", el("label", { for: "bl-draft-" + i, text: d.slug + ". " + note })]),
          region,
          el("p", { text: d.truncated ? "The draft is long and is shown shortened." : "" }),
        ]),
      );
    });
  }

  function figure(src, alt, caption) {
    const img = el("img", { src, alt, loading: "lazy", width: "320" });
    return el("figure", null, [img, el("figcaption", { text: caption })]);
  }

  function drawCaptures(captures) {
    capturesHost.replaceChildren();
    visualBoxes = [];
    capturesHost.appendChild(el("h3", { id: "bl-caps-h", text: "Proposed screenshots" }));
    if (captures.length === 0) {
      capturesHost.appendChild(el("p", { text: "There are no captured screenshots waiting for review." }));
      return;
    }
    let n = 0;
    for (const c of captures) {
      capturesHost.appendChild(
        el("h4", { text: "Capture " + c.captureId + (c.createdAt ? " (taken " + c.createdAt + ")" : "") }),
      );
      if (Array.isArray(c.failures) && c.failures.length > 0) {
        const ul = el("ul");
        for (const f of c.failures) {
          ul.appendChild(el("li", { text: "Failed: " + f.slug + " " + f.viewport + ". " + f.reason }));
        }
        capturesHost.appendChild(ul);
      }
      for (const e of c.entries) {
        const idx = n++;
        const box = el("input", {
          type: "checkbox",
          id: "bl-vis-" + idx,
          "aria-label": "Select " + e.viewport + " screenshot of " + (e.url || e.slug),
        });
        box.dataset.captureId = c.captureId;
        box.dataset.slug = e.slug;
        box.dataset.viewport = e.viewport;
        box.addEventListener("change", updateSelected);
        visualBoxes.push(box);
        const label = (e.url || e.slug) + ", " + e.viewport;
        const parts = [];
        if (e.hasBaseline) {
          parts.push(
            figure(
              imageUrl("baseline", e.slug, e.viewport, ""),
              "Current approved baseline, " + e.viewport + " viewport, page " + (e.url || e.slug),
              "Current baseline",
            ),
          );
        } else {
          parts.push(el("p", { text: "No current baseline exists for this page and viewport." }));
        }
        parts.push(
          figure(
            imageUrl("proposal", e.slug, e.viewport, c.captureId),
            "Proposed new screenshot, " + e.viewport + " viewport, page " + (e.url || e.slug),
            "Proposed screenshot",
          ),
        );
        const compare = el("details", null, [
          el("summary", { text: "Show screenshots for " + label }),
          el("div", { class: "side-by-side" }, parts),
        ]);
        capturesHost.appendChild(
          el("div", { class: "panel" }, [
            el("p", null, [box, " ", el("label", { for: "bl-vis-" + idx, text: label })]),
            compare,
          ]),
        );
      }
    }
  }

  async function loadAll() {
    const [data, props] = await Promise.all([
      api("/api/baselines?scope=" + SCOPE),
      api("/api/baselines/proposals?scope=" + SCOPE),
    ]);
    drawStatus(data);
    drawDrafts(Array.isArray(props.drafts) ? props.drafts : []);
    drawCaptures(Array.isArray(props.captures) ? props.captures : []);
    updateSelected();
    let cloud = { runs: [] };
    try {
      cloud = await api("/api/baselines/cloud-runs");
    } catch (e) {
      cloud = { runs: [] };
    }
    drawCloud(Array.isArray(cloud.runs) ? cloud.runs : []);
  }

  // ---- polling ----------------------------------------------------------------------
  function setBusy(busy) {
    draftButton.disabled = busy;
    captureButton.disabled = busy;
  }

  function stopPolling() {
    polling = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
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
      setError(e && e.message ? e.message : "The job status could not be read.");
      return;
    }
    if (!polling) return;
    if (job && job.state === "running") {
      if (job.kind === "spec-drafts" || job.kind === "visual-capture") {
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
    try {
      await loadAll();
      announce("The job ended. The lists below are up to date.", true);
    } catch (e) {
      setError(e && e.message ? e.message : "The results could not be read.");
    }
  }

  function startPolling() {
    if (polling) return;
    polling = true;
    setBusy(true);
    timer = setTimeout(pollOnce, POLL_MS);
  }

  async function startJob(path, startedText) {
    setError("");
    setBusy(true);
    try {
      await api(path, { body: { scope: SCOPE } });
    } catch (e) {
      setBusy(false);
      setError(e && e.message ? e.message : "The job could not be started.");
      return;
    }
    progressBox.textContent = startedText;
    announce(startedText + " This runs on this computer only.", true);
    startPolling();
  }

  draftButton.addEventListener("click", () => startJob("/api/baselines/spec/draft", "Writing drafts. Starting."));
  captureButton.addEventListener("click", () =>
    startJob("/api/baselines/visual/capture", "Capturing screenshots. Starting."),
  );

  // ---- approve ------------------------------------------------------------------------
  function resultLine(r) {
    const what = r.kind === "spec" ? "Spec draft for " + r.slug : r.viewport + " screenshot of " + r.slug;
    const state = r.status === "promoted" ? "approved" : r.status === "unchanged" ? "unchanged" : "refused";
    return what + ": " + state + (r.reason ? ". " + r.reason : "");
  }

  approveButton.addEventListener("click", async () => {
    const specs = draftBoxes.filter((b) => b.checked).map((b) => b.dataset.slug);
    const visuals = visualBoxes
      .filter((b) => b.checked)
      .map((b) => ({ captureId: b.dataset.captureId, slug: b.dataset.slug, viewport: b.dataset.viewport }));
    if (specs.length + visuals.length === 0) {
      setError("Select at least one item.");
      return;
    }
    const reviewer = reviewerName();
    if (!reviewer) {
      setError(NEEDS_NAME_TEXT);
      reviewerInput.focus();
      return;
    }
    setError("");
    approveButton.disabled = true;
    try {
      const res = await api("/api/baselines/approve", { body: { scope: SCOPE, reviewer, specs, visuals } });
      const msg =
        "Approved " + res.promoted + ", unchanged " + res.unchanged + ", refused " + res.refused + ".";
      announce(msg, true);
      await loadAll();
      resultBox.replaceChildren(el("p", { text: msg }));
      const ul = el("ul");
      for (const r of Array.isArray(res.results) ? res.results : []) ul.appendChild(el("li", { text: resultLine(r) }));
      resultBox.appendChild(ul);
    } catch (e) {
      setError(e && e.message ? e.message : "The items could not be approved.");
      updateSelected();
    }
  });

  // ---- initial state ----------------------------------------------------------------
  updateSelected();
  try {
    const job = await api("/api/jobs/status");
    if (job && job.state === "running") {
      progressBox.textContent =
        job.kind === "spec-drafts" || job.kind === "visual-capture"
          ? jobText(job)
          : "Another job is running. Please wait.";
      startPolling();
    }
  } catch (e) {
    /* fall through to the lists */
  }
  try {
    await loadAll();
  } catch (e) {
    setError(e && e.message ? e.message : "The baselines could not be read.");
  }
}
