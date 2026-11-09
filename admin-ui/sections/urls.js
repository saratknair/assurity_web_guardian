// Approved URLs: list, add, remove, edit (all staged), and "Update project".
// Text is set with textContent only. Staged state is always stated in words, never by colour alone.

const REVIEWER_KEY = "awg.reviewer";
const MAX_REVIEWER = 80;
const LOCAL_ONLY_TEXT = "Update project saves your changes on this computer only";
const NOT_PUBLISHED_TEXT =
  "It does not publish to GitHub. Publishing is a separate step: use the Publish section when you are ready.";
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

export async function render(root, ctx) {
  const { el, api, announce, showAlert } = ctx;
  let data = null;
  let ops = [];
  let editing = null;

  root.appendChild(
    el("p", {
      text: "These are the web pages the Guardian is allowed to check. Changes are staged first and only change the project files when you choose Update project.",
    }),
  );

  // ---- local alert region -------------------------------------------------
  const errorBox = el("p", { role: "alert", class: "error-text" });
  function setError(message) {
    errorBox.textContent = message || "";
    showAlert(message || "");
  }
  root.appendChild(errorBox);

  // ---- reviewer ---------------------------------------------------------------
  const reviewerInput = el("input", {
    id: "urls-reviewer",
    type: "text",
    maxlength: String(MAX_REVIEWER),
    autocomplete: "name",
    "aria-describedby": "urls-reviewer-help",
  });
  reviewerInput.value = readReviewer();
  reviewerInput.addEventListener("change", () => saveReviewer(reviewerInput.value.trim()));
  root.appendChild(
    el("p", null, [
      el("label", { for: "urls-reviewer", text: "Reviewer name " }),
      reviewerInput,
      el("span", {
        id: "urls-reviewer-help",
        text: " Required to remove, edit, or update. It is recorded in the setup activity log.",
      }),
    ]),
  );

  function reviewerName() {
    const name = reviewerInput.value.trim();
    if (name) saveReviewer(name);
    return name;
  }

  // ---- panels ---------------------------------------------------------------
  const summary = el("p", { "aria-live": "polite" });
  const disabledNote = el("p", { role: "note" });
  disabledNote.hidden = true;
  const tableHost = el("div");
  const editHost = el("div");
  const addPanel = el("section", { class: "panel", "aria-labelledby": "urls-add-h" });
  const stagedPanel = el("section", { class: "panel", "aria-labelledby": "urls-staged-h" });
  root.appendChild(summary);
  root.appendChild(disabledNote);
  root.appendChild(tableHost);
  root.appendChild(editHost);
  root.appendChild(addPanel);
  root.appendChild(stagedPanel);

  // ---- add box ----------------------------------------------------------------
  const addInput = el("input", { id: "urls-add", type: "text", autocomplete: "off", size: "60" });
  const addButton = el("button", { type: "submit", class: "primary", text: "Add address" });
  addPanel.appendChild(el("h3", { id: "urls-add-h", text: "Add a web address" }));
  const addForm = el("form", null, [
    el("label", { for: "urls-add", text: "Web address (one, or several separated by spaces or new lines) " }),
    addInput,
    addButton,
  ]);
  addPanel.appendChild(addForm);
  addForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const list = addInput.value.split(/\s+/).filter((s) => s !== "");
    if (list.length === 0) {
      setError("Enter a web address.");
      addInput.focus();
      return;
    }
    const reviewer = reviewerName();
    if (!reviewer) {
      setError(NEEDS_NAME_TEXT);
      reviewerInput.focus();
      return;
    }
    setError("");
    addButton.disabled = true;
    try {
      const res = await api("/api/urls/add", { body: { urls: list, reviewer } });
      const results = Array.isArray(res.results) ? res.results : [];
      const bad = results.filter((r) => r.status !== "added");
      const okCount = results.length - bad.length;
      if (bad.length > 0) {
        setError(bad.map((r) => r.input + ": " + (r.reason || r.status)).join(" "));
      }
      if (okCount > 0) {
        addInput.value = "";
        announce(plural(okCount, "address", "addresses") + " staged. " + (res.usedText || ""), true);
      }
      await load();
      addInput.focus();
    } catch (e) {
      setError(e && e.message ? e.message : "The address could not be added.");
    } finally {
      addButton.disabled = false;
    }
  });

  // ---- staged list and update button -----------------------------------------
  const stagedList = el("ul");
  const stagedEmpty = el("p", { text: "No staged changes." });
  const updateButton = el("button", { type: "button", class: "primary", text: "Update project" });
  stagedPanel.appendChild(el("h3", { id: "urls-staged-h", text: "Staged changes" }));
  stagedPanel.appendChild(stagedEmpty);
  stagedPanel.appendChild(stagedList);
  stagedPanel.appendChild(el("p", { text: LOCAL_ONLY_TEXT + ". " + NOT_PUBLISHED_TEXT }));
  stagedPanel.appendChild(el("p", null, [updateButton]));
  updateButton.addEventListener("click", async () => {
    const reviewer = reviewerName();
    if (!reviewer) {
      setError(NEEDS_NAME_TEXT);
      reviewerInput.focus();
      return;
    }
    setError("");
    updateButton.disabled = true;
    try {
      const res = await api("/api/project/update", { body: { reviewer } });
      const msg =
        res.applied === 0
          ? "There were no staged changes to apply."
          : "Project updated on this computer: " +
            plural(res.added, "address", "addresses") +
            " added, " +
            plural(res.removed, "address", "addresses") +
            " removed. Nothing has been published to GitHub.";
      announce(msg, true);
      await load();
      stagedEmpty.textContent = msg;
      stagedEmpty.hidden = false;
    } catch (e) {
      setError(e && e.message ? e.message : "The project could not be updated.");
    } finally {
      updateButton.disabled = false;
      updateButton.focus();
    }
  });

  // ---- actions ------------------------------------------------------------------
  async function removeUrl(url, button) {
    const reviewer = reviewerName();
    if (!reviewer) {
      setError(NEEDS_NAME_TEXT);
      reviewerInput.focus();
      return;
    }
    setError("");
    button.disabled = true;
    try {
      const res = await api("/api/urls/remove", { body: { url, reviewer } });
      announce("Removal of " + url + " staged. " + (res.usedText || ""), true);
      await load();
      addInput.focus();
    } catch (e) {
      button.disabled = false;
      setError(e && e.message ? e.message : "The address could not be removed.");
    }
  }

  function showEdit(url) {
    editing = url;
    editHost.replaceChildren();
    const toInput = el("input", { id: "urls-edit-to", type: "text", size: "60", autocomplete: "off" });
    toInput.value = url;
    const save = el("button", { type: "submit", text: "Stage replacement" });
    const cancel = el("button", { type: "button", text: "Cancel" });
    const form = el("form", { "aria-labelledby": "urls-edit-h" }, [
      el("h3", { id: "urls-edit-h", text: "Edit web address" }),
      el("p", { text: "Replacing: " + url }),
      el("p", {
        text: "The new address needs a new baseline approval before it can be checked, so it shows as needing re-approval.",
      }),
      el("label", { for: "urls-edit-to", text: "New web address " }),
      toInput,
      save,
      cancel,
    ]);
    editHost.appendChild(form);
    toInput.focus();
    cancel.addEventListener("click", () => {
      editing = null;
      editHost.replaceChildren();
    });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const to = toInput.value.trim();
      if (!to) {
        setError("Enter the new web address.");
        toInput.focus();
        return;
      }
      const reviewer = reviewerName();
      if (!reviewer) {
        setError(NEEDS_NAME_TEXT);
        reviewerInput.focus();
        return;
      }
      setError("");
      save.disabled = true;
      try {
        const res = await api("/api/urls/edit", { body: { from: url, to, reviewer } });
        announce("Replacement staged: " + res.removed + " with " + res.added + ". " + (res.usedText || ""), true);
        editing = null;
        editHost.replaceChildren();
        await load();
        addInput.focus();
      } catch (e) {
        save.disabled = false;
        setError(e && e.message ? e.message : "The address could not be changed.");
      }
    });
  }

  // ---- drawing --------------------------------------------------------------------
  function badgeText(u) {
    const parts = [];
    if (u.pending === "remove") parts.push("Staged: removal, not yet applied");
    else if (u.pending) parts.push("Staged: new, not yet in the project");
    if (u.requiresReapproval) parts.push("Needs re-approval");
    return parts.length ? parts.join("; ") : "None";
  }

  function drawTable() {
    tableHost.replaceChildren();
    const urls = data.urls;
    if (urls.length === 0) {
      tableHost.appendChild(el("p", { text: "There are no approved web addresses yet." }));
      return;
    }
    const caption = el("caption", { text: "Approved web addresses (" + (data.usedText || "") + ")" });
    const head = el("tr", null, [
      el("th", { scope: "col", text: "Web address" }),
      el("th", { scope: "col", text: "Ready to scan?" }),
      el("th", { scope: "col", text: "Staged change" }),
      el("th", { scope: "col", text: "Actions" }),
    ]);
    const body = el("tbody");
    for (const u of urls) {
      const removeBtn = el("button", { type: "button", text: "Remove", "aria-label": "Remove " + u.url });
      const editBtn = el("button", { type: "button", text: "Edit", "aria-label": "Edit " + u.url });
      if (data.editsDisabled || u.pending === "remove") {
        removeBtn.disabled = true;
        editBtn.disabled = true;
      }
      removeBtn.addEventListener("click", () => removeUrl(u.url, removeBtn));
      editBtn.addEventListener("click", () => showEdit(u.url));
      body.appendChild(
        el("tr", null, [
          el("td", { text: u.url }),
          el("td", { text: u.statusText || u.status }),
          el("td", { text: badgeText(u) }),
          el("td", null, [removeBtn, " ", editBtn]),
        ]),
      );
    }
    tableHost.appendChild(el("table", null, [caption, el("thead", null, [head]), body]));
  }

  function drawStaged() {
    stagedList.replaceChildren();
    for (const o of ops) {
      const what = o.op === "add" ? "Add " : "Remove ";
      const by = o.reviewer ? " (by " + o.reviewer + ")" : "";
      const edit = o.editId ? " (part of an edit)" : "";
      stagedList.appendChild(el("li", { text: what + o.url + edit + by }));
    }
    stagedEmpty.textContent = "No staged changes.";
    stagedEmpty.hidden = ops.length > 0;
    updateButton.disabled = ops.length === 0 || (data && data.editsDisabled);
  }

  function drawAll() {
    summary.textContent =
      (data.usedText || "") + " (maximum " + data.max + "). " + plural(data.pendingCount, "staged change", "staged changes") + ".";
    if (data.editsDisabled && data.disabledReason) {
      disabledNote.textContent = "Changes are turned off: " + data.disabledReason + ".";
      disabledNote.hidden = false;
    } else {
      disabledNote.hidden = true;
    }
    addButton.disabled = !!data.editsDisabled;
    addInput.disabled = !!data.editsDisabled;
    if (data.pendingError) setError(data.pendingError);
    drawTable();
    drawStaged();
  }

  async function load() {
    data = await api("/api/urls");
    try {
      const p = await api("/api/project/pending");
      ops = Array.isArray(p.ops) ? p.ops : [];
    } catch (e) {
      ops = [];
    }
    drawAll();
  }

  await load();
}
