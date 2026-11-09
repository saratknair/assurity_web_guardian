// Setup activity: read-only table of the Setup_Activity_Log, newest first (R25.1, R25.2).
// All values are shown as plain text (textContent only).

const PAGE = 100;

function pairs(obj) {
  if (!obj || typeof obj !== "object") return "";
  return Object.keys(obj)
    .map((k) => k + ": " + String(obj[k]))
    .join(", ");
}

function entryRow(el, e) {
  const reviewer = e.reviewer ? e.reviewer : "(none)";
  const counts = pairs(e.counts);
  const detail = pairs(e.detail);
  return el("tr", null, [
    el("td", { text: String(e.at) }),
    el("td", { text: reviewer }),
    el("td", { text: String(e.action) }),
    el("td", { text: String(e.summary || "") }),
    el("td", { text: counts || "-" }),
    el("td", { text: detail || "-" }),
  ]);
}

export async function render(root, ctx) {
  const { el, api, announce } = ctx;
  const intro = el("p", {
    text: "Every setup change made in this console, newest first. This log stays on this computer and is never published.",
  });
  const note = el("p", { role: "status" });
  const tbody = el("tbody");
  const headers = ["Time (UTC)", "Reviewer", "Action", "Summary", "Counts", "Details"];
  const table = el("table", null, [
    el("caption", { text: "Setup activity, newest first" }),
    el("thead", null, [el("tr", null, headers.map((h) => el("th", { scope: "col", text: h })))]),
    tbody,
  ]);
  const more = el("button", { type: "button", text: "Show earlier entries" });
  more.hidden = true;
  const empty = el("p", { text: "No setup activity has been recorded yet." });
  empty.hidden = true;
  root.appendChild(intro);
  root.appendChild(note);
  root.appendChild(table);
  root.appendChild(empty);
  root.appendChild(more);

  let oldest = "";
  let shown = 0;
  let skipped = 0;

  async function load(first) {
    more.disabled = true;
    const q = "/api/setup-log?limit=" + PAGE + (oldest ? "&before=" + encodeURIComponent(oldest) : "");
    const page = await api(q);
    const entries = Array.isArray(page.entries) ? page.entries : [];
    for (const e of entries) tbody.appendChild(entryRow(el, e));
    shown += entries.length;
    if (typeof page.skippedLines === "number") skipped = Math.max(skipped, page.skippedLines);
    if (entries.length) oldest = entries[entries.length - 1].at;
    table.hidden = shown === 0;
    empty.hidden = shown !== 0;
    more.hidden = entries.length < PAGE;
    more.disabled = false;
    note.textContent = skipped > 0 ? skipped + " unreadable line(s) in the log were skipped." : "";
    announce(shown + " setup entries shown.", true);
    if (!first && entries.length) more.focus();
  }

  more.addEventListener("click", () => {
    load(false).catch((e) => {
      more.disabled = false;
      ctx.showAlert(e && e.message ? e.message : "Could not load earlier entries.");
    });
  });

  await load(true);
}
