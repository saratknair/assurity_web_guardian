// Runs and logs: run table (newest first), details, log viewer and "Pull runs from GitHub".
// All values are shown as plain text (textContent only).

const POLL_MS = 1000;
const MAX_POLLS = 600;

function word(value, fallback) {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function sectionNote(label, s) {
  if (s && s.ok) return null;
  const reason = s && typeof s.reason === "string" ? s.reason : "no information";
  return label + " could not be read: " + reason + ".";
}

function syncPart(label, part) {
  if (!part) return label + ": no result yet.";
  if (part.ok) {
    const extra = typeof part.skipped === "number" ? ", " + part.skipped + " skipped" : "";
    return label + ": finished, " + part.added + " added" + extra + ".";
  }
  return label + ": did not finish. " + word(part.reason, "Unknown reason.");
}

export async function render(root, ctx) {
  const { el, api, announce, showAlert } = ctx;

  root.appendChild(
    el("p", {
      text:
        "These are the monitoring runs present on this computer. A run that happened elsewhere appears only after you pull it. " +
        "Setup work such as discovery and baselines never appears here, because it is not a monitoring run; see Setup activity for that.",
    }),
  );

  // ---- Pull from GitHub ----
  const pullBtn = el("button", { type: "button", class: "primary", text: "Pull runs from GitHub" });
  const pullStatus = el("p", { role: "status" });
  root.appendChild(el("p", null, [pullBtn]));
  root.appendChild(pullStatus);

  // ---- Table ----
  const listNote = el("p", { role: "status" });
  const tbody = el("tbody");
  const headers = ["Run", "Date", "Status", "Health", "Pages", "Failed checks", "Trigger", "Marker", "Details"];
  const table = el("table", null, [
    el("caption", { text: "Monitoring runs, newest first" }),
    el("thead", null, [el("tr", null, headers.map((h) => el("th", { scope: "col", text: h })))]),
    tbody,
  ]);
  const empty = el("p", { text: "No monitoring runs are present on this computer yet." });
  empty.hidden = true;
  root.appendChild(listNote);
  root.appendChild(table);
  root.appendChild(empty);

  // ---- Details ----
  const detail = el("div", { "aria-live": "polite" });
  root.appendChild(detail);

  let detailToken = 0;
  let alive = true;
  let pollTimer = null;

  function stopPolling() {
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
  }

  // ---- Log viewer ----
  function logViewer(runId, name, bytes) {
    const wrap = el("div");
    const heading = el("h4", { text: "Log: " + name + " (" + bytes + " bytes)" });
    const preId = "log-" + name;
    const pre = el("pre", {
      id: preId,
      class: "scroll-region",
      tabindex: "0",
      role: "region",
      "aria-label": "Log " + name + " for run " + runId,
    });
    const info = el("p", { role: "status" });
    const earlier = el("button", { type: "button", text: "Load earlier lines" });
    earlier.hidden = true;
    const load = el("button", { type: "button", text: "Show log" });
    let lines = [];
    let startOffset = null;
    let totalBytes = 0;
    let busy = false;

    function paint() {
      pre.textContent = lines.join("\n");
      const more = startOffset !== null && startOffset > 0;
      info.textContent =
        "Showing the last " + lines.length + " lines of this log" + (more ? ", not the whole file. Load earlier lines to see more." : ".");
      earlier.hidden = !more;
    }

    async function fetchPage(before) {
      if (busy) return;
      busy = true;
      earlier.disabled = true;
      load.disabled = true;
      try {
        const q =
          "/api/runs/" + encodeURIComponent(runId) + "/log?file=" + encodeURIComponent(name) +
          (before === null ? "" : "&before=" + encodeURIComponent(String(before)));
        const page = await api(q);
        if (!page || page.ok === false) {
          info.textContent = "This log could not be read" + (page && page.reason ? ": " + page.reason : ".");
          return;
        }
        const got = Array.isArray(page.lines) ? page.lines.map((l) => String(l)) : [];
        lines = before === null ? got : got.concat(lines);
        startOffset = typeof page.startOffset === "number" ? page.startOffset : 0;
        totalBytes = typeof page.totalBytes === "number" ? page.totalBytes : totalBytes;
        load.hidden = true;
        paint();
        if (before !== null) earlier.focus();
      } catch (e) {
        info.textContent = e && e.message ? e.message : "Could not load the log.";
      } finally {
        busy = false;
        earlier.disabled = false;
        load.disabled = false;
      }
    }

    load.addEventListener("click", () => fetchPage(null));
    earlier.addEventListener("click", () => {
      if (startOffset !== null && startOffset > 0) fetchPage(startOffset);
    });
    wrap.appendChild(heading);
    wrap.appendChild(el("p", null, [load, earlier]));
    wrap.appendChild(info);
    wrap.appendChild(pre);
    return wrap;
  }

  function renderDetail(run, d) {
    const box = el("section", { "aria-label": "Details for run " + run.runId });
    box.appendChild(el("h3", { text: "Run " + run.runId }));
    if (run.latest) box.appendChild(el("p", { text: "This is the latest run." }));
    else box.appendChild(el("p", { text: "This is an earlier run, not the latest." }));

    const notes = [
      sectionNote("The run summary", d.summary),
      sectionNote("The run source record", d.source),
      sectionNote("The results", d.results),
      sectionNote("The findings", d.findings),
    ].filter((n) => n !== null);
    if (notes.length) {
      const ul = el("ul");
      for (const n of notes) ul.appendChild(el("li", { text: n }));
      box.appendChild(el("p", { text: "Some parts of this run could not be read. The rest is shown below." }));
      box.appendChild(ul);
    }

    const facts = el("ul");
    const s = d.summary && d.summary.ok ? d.summary : null;
    if (s) {
      facts.appendChild(el("li", { text: "Status: " + word(s.status, "unknown") }));
      facts.appendChild(el("li", { text: "Health: " + word(s.health, "unknown") }));
      facts.appendChild(el("li", { text: "Finished: " + word(s.finishedAt, "unknown") }));
      facts.appendChild(el("li", { text: "Pages: " + word(s.pages, "unknown") }));
      facts.appendChild(el("li", { text: "Failed checks: " + word(s.failedChecks, "unknown") }));
      facts.appendChild(el("li", { text: "Pending review: " + word(s.pendingReview, "unknown") }));
      facts.appendChild(el("li", { text: "Origin: " + word(s.origin, "unknown") }));
      if (s.domain) facts.appendChild(el("li", { text: "Domain: " + String(s.domain) }));
    }
    if (d.source && d.source.ok) {
      facts.appendChild(el("li", { text: "Trigger: " + word(d.source.trigger, "unknown") }));
    }
    if (d.results && d.results.ok) facts.appendChild(el("li", { text: "Pages in results: " + d.results.pages }));
    if (d.findings && d.findings.ok) {
      facts.appendChild(el("li", { text: "Pages in findings: " + d.findings.pages }));
      facts.appendChild(el("li", { text: d.findings.awaitingReview ? "Findings are awaiting review." : "Findings are not awaiting review." }));
    }
    if (facts.childNodes.length) box.appendChild(facts);

    const url = d.githubRunUrl || run.githubRunUrl;
    const gid = (d.source && d.source.ok && d.source.githubRunId) || run.githubRunId;
    if (url) {
      box.appendChild(
        el("p", null, [
          el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: "GitHub Actions run " + word(gid, "page") }),
        ]),
      );
    }

    const logs = Array.isArray(d.logs) ? d.logs : [];
    if (logs.length === 0) {
      box.appendChild(el("p", { text: "No logs are available for this run." }));
    } else {
      for (const l of logs) box.appendChild(logViewer(run.runId, String(l.name), Number(l.bytes) || 0));
    }
    return box;
  }

  async function selectRun(run, button) {
    const token = ++detailToken;
    detail.replaceChildren(el("p", { text: "Loading run " + run.runId + "..." }));
    try {
      const d = await api("/api/runs/" + encodeURIComponent(run.runId));
      if (token !== detailToken || !alive) return;
      const box = renderDetail(run, d);
      detail.replaceChildren(box);
      for (const b of tbody.querySelectorAll("button")) b.removeAttribute("aria-pressed");
      if (button) button.setAttribute("aria-pressed", "true");
      announce("Details for run " + run.runId + " shown.", true);
    } catch (e) {
      if (token !== detailToken) return;
      detail.replaceChildren(el("p", { text: "This run could not be loaded. " + (e && e.message ? e.message : "") }));
    }
  }

  function runRow(run) {
    const btn = el("button", { type: "button", text: "Show details", "aria-label": "Show details for run " + run.runId });
    btn.addEventListener("click", () => selectRun(run, btn));
    return el("tr", null, [
      el("th", { scope: "row", text: run.runId }),
      el("td", { text: word(run.date, "unknown") }),
      el("td", { text: word(run.status, "unknown") }),
      el("td", { text: word(run.health, "unknown") }),
      el("td", { text: word(run.pages, "-") }),
      el("td", { text: word(run.failedChecks, "-") }),
      el("td", { text: word(run.trigger, "not recorded") }),
      el("td", { text: run.latest ? "Latest run" : "Earlier run" }),
      el("td", null, [btn]),
    ]);
  }

  let firstLoad = true;
  async function loadRuns() {
    const data = await api("/api/runs");
    const runs = data && Array.isArray(data.runs) ? data.runs : [];
    tbody.replaceChildren();
    for (const r of runs) tbody.appendChild(runRow(r));
    table.hidden = runs.length === 0;
    empty.hidden = runs.length !== 0;
    listNote.textContent = runs.length ? runs.length + " run(s) shown. The latest is " + word(data.latestRunId, "unknown") + "." : "";
    if (firstLoad && runs.length) {
      firstLoad = false;
      const firstBtn = tbody.querySelector("button");
      selectRun(runs[0], firstBtn);
    }
  }

  // ---- Pull / poll ----
  function showSync(st, final) {
    const parts = [syncPart("Runs", st.runs), syncPart("Decisions", st.decisions)];
    pullStatus.textContent = (final ? "Pull finished. " : "Pulling from GitHub... ") + parts.join(" ");
  }

  function poll(count) {
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      if (!alive || !root.isConnected) return;
      try {
        const st = await api("/api/sync/status");
        if (st && st.state === "running" && count < MAX_POLLS) {
          showSync(st, false);
          poll(count + 1);
          return;
        }
        showSync(st || {}, true);
        pullBtn.disabled = false;
        announce(pullStatus.textContent, true);
        await loadRuns();
      } catch (e) {
        pullBtn.disabled = false;
        pullStatus.textContent = e && e.message ? e.message : "Could not read the pull status.";
      }
    }, POLL_MS);
  }

  pullBtn.addEventListener("click", async () => {
    stopPolling();
    pullBtn.disabled = true;
    pullStatus.textContent = "Pulling from GitHub...";
    try {
      await api("/api/sync", { body: {} });
    } catch (e) {
      const msg = e && e.message ? e.message : "";
      if (/already running/i.test(msg)) {
        pullStatus.textContent = "A pull is already running. Waiting for it to finish.";
      } else {
        pullBtn.disabled = false;
        pullStatus.textContent = "The pull could not start. " + msg;
        return;
      }
    }
    poll(0);
  });

  // Stop polling once this section is replaced.
  const watcher = setInterval(() => {
    if (!root.isConnected) {
      alive = false;
      stopPolling();
      clearInterval(watcher);
    }
  }, POLL_MS);

  try {
    await loadRuns();
  } catch (e) {
    showAlert(e && e.message ? e.message : "Could not load the runs.");
  }
}
