// Schedule section: view and edit the cron line of the GitHub workflow file (Requirements 28).
// The schedule lives only in the workflow file. A save changes this folder only; Publish sends it.

const REVIEWER_KEY = "awg.reviewer";

function readReviewer() {
  try {
    return window.localStorage.getItem(REVIEWER_KEY) || "";
  } catch (e) {
    return "";
  }
}

function storeReviewer(name) {
  try {
    window.localStorage.setItem(REVIEWER_KEY, name);
  } catch (e) {
    /* storage unavailable; the name is still sent with the request */
  }
}

export async function render(root, ctx) {
  const { api, el, announce, showAlert } = ctx;

  const current = el("div", { class: "schedule-current" });
  const result = el("div", { class: "schedule-result", role: "status" });
  const errorBox = el("p", { class: "schedule-error", role: "alert" });

  const cronInput = el("input", { id: "schedule-cron", type: "text", autocomplete: "off", spellcheck: "false", "aria-describedby": "schedule-cron-hint" });
  const reviewerInput = el("input", { id: "schedule-reviewer", type: "text", autocomplete: "name" });
  reviewerInput.value = readReviewer();
  const saveBtn = el("button", { type: "submit", class: "primary", text: "Save schedule" });

  const form = el("form", { class: "schedule-form", novalidate: "novalidate" }, [
    el("p", { id: "schedule-cron-hint", text: "Five fields: minute hour day-of-month month day-of-week, in UTC. Example: 0 2 * * 1-5. Gaps under 5 minutes are not allowed." }),
    el("p", null, [el("label", { for: "schedule-cron", text: "New schedule (cron)" }), el("br"), cronInput]),
    el("p", null, [el("label", { for: "schedule-reviewer", text: "Reviewer name" }), el("br"), reviewerInput]),
    el("p", null, [saveBtn]),
  ]);

  root.appendChild(el("p", { text: "The schedule lives only in the GitHub workflow file. There is no separate local schedule." }));
  root.appendChild(current);
  root.appendChild(form);
  root.appendChild(errorBox);
  root.appendChild(result);

  function setFormEnabled(on) {
    for (const n of [cronInput, reviewerInput, saveBtn]) {
      if (on) n.removeAttribute("disabled");
      else n.setAttribute("disabled", "disabled");
    }
  }

  function addWarnings(parent, warnings) {
    if (!Array.isArray(warnings) || warnings.length === 0) return;
    const ul = el("ul", { class: "schedule-warnings" });
    for (const w of warnings) ul.appendChild(el("li", { text: "Warning: " + String(w) }));
    parent.appendChild(ul);
  }

  function showCurrent(data) {
    current.replaceChildren();
    current.appendChild(el("h3", { text: "Current schedule" }));
    const dl = el("dl");
    dl.appendChild(el("dt", { text: "In this folder (cron)" }));
    dl.appendChild(el("dd", { text: data.cron }));
    dl.appendChild(el("dt", { text: "In plain English" }));
    dl.appendChild(el("dd", { text: data.summary || "Not available for this value." }));
    dl.appendChild(el("dt", { text: "Currently on GitHub" }));
    dl.appendChild(el("dd", { text: data.onGitHub ? data.onGitHub : "unknown" }));
    current.appendChild(dl);
    current.appendChild(el("p", { text: data.utcNote || "Times are in UTC." }));
    if (data.onGitHub && data.onGitHub !== data.cron) {
      current.appendChild(el("p", { text: "This folder differs from GitHub. Publish to send the local value." }));
    }
    addWarnings(current, data.warnings);
    if (data.note) current.appendChild(el("p", { text: data.note }));
  }

  let data;
  try {
    data = await api("/api/schedule");
  } catch (e) {
    current.replaceChildren(
      el("h3", { text: "Current schedule" }),
      el("p", { text: "The schedule cannot be edited here. " + (e && e.message ? e.message : "Unknown error.") }),
      el("p", { text: "Times are in UTC. The schedule lives only in the GitHub workflow file." }),
    );
    setFormEnabled(false);
    return;
  }

  showCurrent(data);
  cronInput.value = data.cron;
  if (data.editable === false) setFormEnabled(false);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    errorBox.textContent = "";
    result.replaceChildren();
    showAlert("");
    const reviewer = reviewerInput.value.trim();
    const cron = cronInput.value.trim();
    if (!reviewer) {
      errorBox.textContent = "Enter a reviewer name.";
      reviewerInput.focus();
      return;
    }
    if (!cron) {
      errorBox.textContent = "Enter a schedule.";
      cronInput.focus();
      return;
    }
    storeReviewer(reviewer);
    setFormEnabled(false);
    announce("Saving schedule.", true);
    try {
      const out = await api("/api/schedule", { body: { cron, reviewer } });
      data = Object.assign({}, data, { cron: out.cron, summary: out.summary, utcNote: out.utcNote, warnings: out.warnings });
      showCurrent(data);
      cronInput.value = out.cron;
      result.appendChild(el("p", { text: "Saved in this folder only. Previous value: " + out.previous + ". " + (out.note || "") }));
      const link = el("a", { href: "#publish", text: "Go to Publish" });
      result.appendChild(el("p", null, [link, " to make this change take effect on GitHub."]));
      if (out.githubNote) result.appendChild(el("p", { text: out.githubNote }));
      addWarnings(result, out.warnings);
      if (out.warning) result.appendChild(el("p", { text: out.warning }));
      announce("Schedule saved in this folder. Publish to apply it on GitHub.", true);
    } catch (e) {
      errorBox.textContent = e && e.message ? e.message : "The schedule could not be saved.";
      announce("The schedule was not saved.", true);
      cronInput.focus();
    } finally {
      setFormEnabled(true);
    }
  });
}
