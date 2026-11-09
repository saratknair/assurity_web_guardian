// Discovery: find candidate pages on this computer, then approve the ones you choose.
// Text is set with textContent only. Status is always stated in words, never by colour alone.

const REVIEWER_KEY = "awg.reviewer";
const MAX_REVIEWER = 80;
const POLL_MS = 1000;
const SCOPE = "current";
const LOCAL_TEXT =
  "Discovery runs on this computer only. It does not involve GitHub and nothing is pushed or published.";
const STAGED_TEXT =
  "Approved pages are staged first. They change the project files when you choose Update project in the Approved URLs section.";
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

function progressText(job) {
  const secs = Math.floor((Number.isFinite(job.elapsedMs) ? job.elapsedMs : 0) / 1000);
  let text = "Finding pages. " + secs + " seconds so far.";
  const p = job.progress;
  if (p && typeof p === "object" && Number.isFinite(p.total) && p.total > 0) {
    text = "Finding pages: " + p.done + " of " + p.total + " checked. " + secs + " seconds so far.";
  }
  return text;
}

export async function render(root, ctx) {
  const { el, api, announce, showAlert } = ctx;
  let polling = false;
  let timer = null;

  root.appendChild(el("p", { text: LOCAL_TEXT }));
  root.appendChild(el("p", { text: STAGED_TEXT }));

  const errorBox = el("p", { role: "alert", class: "error-text" });
  function setError(message) {
    errorBox.textContent = message || "";
    showAlert(message || "");
  }
  root.appendChild(errorBox);

  // ---- reviewer ---------------------------------------------------------------
  const reviewerInput = el("input", {
    id: "disc-reviewer",
    type: "text",
    maxlength: String(MAX_REVIEWER),
    autocomplete: "name",
    "aria-describedby": "disc-reviewer-help",
  });
  reviewerInput.value = readReviewer();
  reviewerInput.addEventListener("change", () => saveReviewer(reviewerInput.value.trim()));
  root.appendChild(
    el("p", null, [
      el("label", { for: "disc-reviewer", text: "Reviewer name " }),
      reviewerInput,
      el("span", {
        id: "disc-reviewer-help",
        text: " Required to approve pages. It is recorded in the setup activity log.",
      }),
    ]),
  );

  function reviewerName() {
    const name = reviewerInput.value.trim();
    if (name) saveReviewer(name);
    return name;
  }

  // ---- run controls -------------------------------------------------------------
  const findButton = el("button", { type: "button", class: "primary", text: "Find pages" });
  const progressBox = el("p", { role: "status" });
  const outcomeBox = el("p", { role: "status" });
  const listHost = el("div");
  root.appendChild(el("p", null, [findButton]));
  root.appendChild(progressBox);
  root.appendChild(outcomeBox);
  root.appendChild(listHost);

  // ---- candidates -----------------------------------------------------------------
  let boxes = [];
  const approveButton = el("button", { type: "button", text: "Approve selected" });
  const selectedCount = el("span", { "aria-live": "polite" });

  function updateSelected() {
    const n = boxes.filter((b) => b.checked).length;
    selectedCount.textContent = " " + plural(n, "page", "pages") + " selected.";
    approveButton.disabled = n === 0;
  }

  function drawCandidates(data) {
    listHost.replaceChildren();
    boxes = [];
    const list = Array.isArray(data.candidates) ? data.candidates : [];
    if (data.state !== "ready" || list.length === 0) return;
    const caption = el("caption", {
      text: "Pages found for " + data.domain + (data.generatedAt ? " (found " + data.generatedAt + ")" : ""),
    });
    const head = el("tr", null, [
      el("th", { scope: "col", text: "Select" }),
      el("th", { scope: "col", text: "Web address" }),
      el("th", { scope: "col", text: "Title" }),
      el("th", { scope: "col", text: "Status" }),
    ]);
    const body = el("tbody");
    list.forEach((c, i) => {
      let selectCell;
      let statusText;
      if (c.approvable) {
        const box = el("input", { type: "checkbox", id: "disc-pick-" + i, "aria-label": "Select " + c.url });
        box.dataset.url = c.url;
        box.addEventListener("change", updateSelected);
        boxes.push(box);
        selectCell = el("td", null, [box]);
        statusText = "Not yet approved";
      } else {
        selectCell = el("td", { text: "-" });
        statusText = c.alreadyApproved ? "Already approved" : "Cannot be approved: " + (c.reason || "not suitable");
      }
      const title = c.title || c.h1 || "";
      body.appendChild(
        el("tr", null, [
          selectCell,
          el("td", { text: c.url }),
          el("td", { text: title }),
          el("td", { text: statusText }),
        ]),
      );
    });
    listHost.appendChild(el("table", null, [caption, el("thead", null, [head]), body]));
    listHost.appendChild(el("p", null, [approveButton, selectedCount]));
    updateSelected();
  }

  async function loadCandidates() {
    const data = await api("/api/discovery/candidates?scope=" + SCOPE);
    outcomeBox.textContent = data.outcome || "";
    drawCandidates(data);
    return data;
  }

  // ---- polling ----------------------------------------------------------------------
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
      findButton.disabled = false;
      setError(e && e.message ? e.message : "The job status could not be read.");
      return;
    }
    if (!polling) return;
    if (job && job.state === "running") {
      if (job.kind === "discovery") {
        progressBox.textContent = progressText(job);
        announce(progressText(job), false);
      } else {
        progressBox.textContent = "Another job (" + (job.kind || "unknown") + ") is running. Please wait.";
      }
      timer = setTimeout(pollOnce, POLL_MS);
      return;
    }
    stopPolling();
    progressBox.textContent = "";
    findButton.disabled = false;
    try {
      const data = await loadCandidates();
      announce("Finding pages ended. " + (data.outcome || ""), true);
    } catch (e) {
      setError(e && e.message ? e.message : "The results could not be read.");
    }
    findButton.focus();
  }

  function startPolling() {
    if (polling) return;
    polling = true;
    findButton.disabled = true;
    timer = setTimeout(pollOnce, POLL_MS);
  }

  findButton.addEventListener("click", async () => {
    setError("");
    findButton.disabled = true;
    try {
      await api("/api/discovery/run", { body: { scope: SCOPE } });
    } catch (e) {
      findButton.disabled = false;
      setError(e && e.message ? e.message : "Discovery could not be started.");
      return;
    }
    listHost.replaceChildren();
    boxes = [];
    outcomeBox.textContent = "";
    progressBox.textContent = "Finding pages. Starting.";
    announce("Finding pages started. This runs on this computer only.", true);
    startPolling();
  });

  approveButton.addEventListener("click", async () => {
    const urls = boxes.filter((b) => b.checked).map((b) => b.dataset.url);
    if (urls.length === 0) {
      setError("Select at least one page.");
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
      const res = await api("/api/discovery/approve", { body: { scope: SCOPE, urls, reviewer } });
      const msg =
        res.approved === 0
          ? res.message || "No pages were staged."
          : plural(res.approved, "page", "pages") +
            " staged. " +
            (res.usedText || "") +
            " Choose Update project in the Approved URLs section to apply them.";
      announce(msg, true);
      await loadCandidates();
      outcomeBox.textContent = msg;
    } catch (e) {
      setError(e && e.message ? e.message : "The pages could not be approved.");
      updateSelected();
    }
  });

  // ---- initial state ----------------------------------------------------------------
  try {
    const job = await api("/api/jobs/status");
    if (job && job.state === "running") {
      progressBox.textContent = job.kind === "discovery" ? progressText(job) : "Another job is running. Please wait.";
      startPolling();
      return;
    }
  } catch (e) {
    /* fall through to the candidates request */
  }
  try {
    await loadCandidates();
  } catch (e) {
    setError(e && e.message ? e.message : "The discovery results could not be read.");
  }
}
