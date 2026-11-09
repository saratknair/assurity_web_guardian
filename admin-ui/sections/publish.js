// Publish section (design J.8, J.9, J.11; Requirements 26, 27, 30).
// All text is set with textContent. No HTML is parsed. No inline script or style.

const REVIEWER_KEY = "awg.reviewer";

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
    /* storage may be unavailable; the name is still sent with the request */
  }
}

function mb(bytes) {
  return (Number(bytes) / (1024 * 1024)).toFixed(1) + " MB";
}

function sizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return mb(n);
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " bytes";
}

/** Plain-text lines for the Git_Feedback_View. */
export function feedbackLines(records) {
  const out = [];
  if (!Array.isArray(records)) return out;
  for (const r of records) {
    if (!r || typeof r !== "object") continue;
    const when = typeof r.at === "string" ? r.at : typeof r.timestamp === "string" ? r.timestamp : "";
    const head = [when, String(r.op || "git"), r.ok === false ? "FAILED" : "ok"].filter(Boolean).join(" ");
    out.push(head);
    if (typeof r.commit === "string" && r.commit) out.push("  commit " + r.commit);
    if (typeof r.pushedAt === "string" && r.pushedAt) out.push("  pushed " + r.pushedAt);
    if (Array.isArray(r.lines)) for (const l of r.lines) out.push("  " + String(l));
  }
  return out;
}

export async function render(root, ctx) {
  const el = ctx.el;
  const api = ctx.api;
  let status = null;
  let feedback = { records: [], lastPublished: null };
  let lastFailure = null;
  let lastRequest = null;

  const intro = el("div", { class: "panel" }, [
    el("p", {
      text: "Update project saves your changes in the local files on this computer only. Nothing leaves this computer.",
    }),
    el("p", {
      text: "Publish to GitHub sends the configuration files to GitHub so the daily run uses them. It makes one commit and pushes it to main, and that push starts a run on GitHub automatically.",
    }),
    el("p", {
      text: "A run is started by publishing. Starting a run without any change would need a stored GitHub token, which this console does not use, so there is no separate start button.",
    }),
  ]);

  const result = el("div", { id: "publish-result", role: "status" });
  const body = el("div", { id: "publish-body" });
  root.appendChild(intro);
  root.appendChild(body);
  root.appendChild(result);

  async function load() {
    status = await api("/api/publish/status");
    try {
      feedback = await api("/api/git/feedback");
    } catch (e) {
      feedback = { records: [], lastPublished: status && status.lastPublished ? status.lastPublished : null };
    }
    draw();
  }

  function deltaList(title, list, mark, label) {
    const items = [];
    for (const p of list) items.push(el("li", { text: mark + " " + label + ": " + p }));
    return el("div", null, [el("h4", { text: title + " (" + list.length + ")" }), el("ul", null, items)]);
  }

  function draw() {
    const s = status || {};
    const d = s.delta || { added: [], modified: [], deleted: [] };
    const count = (d.added.length || 0) + (d.modified.length || 0) + (d.deleted.length || 0);
    const parts = [];

    // Unpublished local changes
    const badgeText = count > 0 ? "Unpublished local changes: " + count + " file" + (count === 1 ? "" : "s") : "No unpublished local changes";
    parts.push(
      el("p", null, [el("span", { class: count > 0 ? "badge pending" : "badge", text: badgeText })]),
    );

    // Warnings
    if (Array.isArray(s.warnings)) {
      for (const w of s.warnings) parts.push(el("p", { class: "panel", text: "Note: " + w }));
    }

    // Delta list
    const deltaPanel = el("div", { class: "panel" }, [el("h3", { text: "Files that would be published" })]);
    if (count === 0) {
      deltaPanel.appendChild(el("p", { text: "There are no files to publish." }));
    } else {
      const sizes = s.sizes || {};
      deltaPanel.appendChild(
        el("p", {
          text:
            "Total size of added and changed files: " +
            sizeText(sizes.totalBytes) +
            (sizes.largestPath ? ". Largest: " + sizes.largestPath + " (" + sizeText(sizes.largestBytes) + ")." : "."),
        }),
      );
      const wrap = el("div", { class: "scroll-region", tabindex: "0", role: "region", "aria-label": "Files that would be published" });
      if (d.added.length) wrap.appendChild(deltaList("Added", d.added, "+", "Added"));
      if (d.modified.length) wrap.appendChild(deltaList("Modified", d.modified, "~", "Changed"));
      if (d.deleted.length) wrap.appendChild(deltaList("Deleted", d.deleted, "-", "Deleted"));
      deltaPanel.appendChild(wrap);
    }
    parts.push(deltaPanel);

    // Commit message preview
    if (count > 0 && typeof s.commitMessage === "string" && s.commitMessage) {
      parts.push(
        el("div", { class: "panel" }, [
          el("h4", { id: "publish-commit-label", text: "Commit message that will be used" }),
          el("p", { text: "Your name replaces <your name> when you publish." }),
          el("pre", { class: "terminal scroll-region", id: "publish-commit-message", tabindex: "0", role: "region", "aria-labelledby": "publish-commit-label", text: s.commitMessage }),
        ]),
      );
    }

    // Form
    const form = el("form", { class: "panel", id: "publish-form" });
    form.appendChild(el("h3", { text: "Publish" }));
    form.appendChild(targetPanel(s));
    const nameInput = el("input", { id: "publish-reviewer", type: "text", autocomplete: "name", maxlength: "80", required: "required" });
    nameInput.value = readReviewer();
    form.appendChild(el("p", null, [el("label", { for: "publish-reviewer", text: "Reviewer name " }), nameInput]));
    form.appendChild(
      el("p", { text: "Your name appears in the commit message on GitHub, which is public." }),
    );

    let ackDel = null;
    let ackSize = null;
    if (s.needsDeleteAck) {
      ackDel = el("input", { id: "publish-ack-delete", type: "checkbox" });
      form.appendChild(
        el("p", null, [ackDel, el("label", { for: "publish-ack-delete", text: " I understand that " + d.deleted.length + " file(s) will be deleted from GitHub" })]),
      );
    }
    if (s.needsSizeAck) {
      const pngMb = s.sizes ? mb(s.sizes.pngBytes) : "a large amount";
      ackSize = el("input", { id: "publish-ack-size", type: "checkbox" });
      form.appendChild(
        el("p", null, [ackSize, el("label", { for: "publish-ack-size", text: " I understand this adds " + pngMb + " of baseline images to the repository permanently" })]),
      );
    }
    const confirm = el("input", { id: "publish-confirm", type: "checkbox" });
    form.appendChild(
      el("p", null, [confirm, el("label", { for: "publish-confirm", text: " Yes, publish these files to GitHub now" })]),
    );

    const can = s.canPublish === true && count > 0;
    const btn = el("button", { type: "submit", id: "publish-button", class: "primary" });
    if (!can) {
      btn.setAttribute("disabled", "disabled");
      btn.setAttribute("aria-describedby", "publish-reason");
      btn.textContent = count === 0 ? "Nothing to publish" : "Publish to GitHub";
    } else {
      btn.textContent = "Publish to GitHub";
    }
    form.appendChild(el("p", null, [btn]));
    if (!can) {
      const why = count === 0 ? "Nothing to publish" : String(s.message || "Publishing is not available right now");
      form.appendChild(el("p", { id: "publish-reason", text: "Why it is disabled: " + why }));
    }

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        ctx.showAlert("Enter your Reviewer name first.");
        nameInput.focus();
        return;
      }
      if (!confirm.checked) {
        ctx.showAlert("Tick the confirmation box to publish.");
        confirm.focus();
        return;
      }
      if (ackDel && !ackDel.checked) {
        ctx.showAlert("Confirm the deletions to publish.");
        ackDel.focus();
        return;
      }
      if (ackSize && !ackSize.checked) {
        ctx.showAlert("Confirm the size notice to publish.");
        ackSize.focus();
        return;
      }
      ctx.showAlert("");
      saveReviewer(name);
      lastRequest = {
        purpose: "publish",
        reviewer: name,
        confirm: true,
        acknowledgeDeletes: ackDel ? ackDel.checked : false,
        acknowledgeSize: ackSize ? ackSize.checked : false,
      };
      send(btn);
    });
    parts.push(form);

    // Retry control
    if (lastFailure !== null && lastRequest !== null) {
      const retry = el("button", { type: "button", id: "publish-retry", text: "Retry publish" });
      retry.addEventListener("click", () => send(retry));
      parts.push(
        el("div", { class: "panel error" }, [
          el("p", { text: "The last publish failed: " + lastFailure }),
          el("p", null, [retry]),
        ]),
      );
    }

    // Last published and Git_Feedback_View
    parts.push(feedbackPanel(s));
    body.replaceChildren(...parts);
  }

  function targetPanel(s) {
    const t = s.target || {};
    const where = t.remote || "(no GitHub remote found)";
    const branch = t.branch || s.targetBranch || "main";
    return el("div", { id: "publish-target", role: "group", "aria-label": "Where this will be published" }, [
      el("p", null, [
        el("strong", { text: "Will push to " + where + ", branch " + branch + ", as one new commit containing only the files listed below." }),
      ]),
      el("p", {
        text: "The push to " + branch + " starts a run on GitHub automatically. Publish only when the list is what you expect.",
      }),
    ]);
  }

  function feedbackPanel(s) {
    const lp = feedback.lastPublished || s.lastPublished || null;
    const panel = el("div", { class: "panel" }, [el("h3", { text: "Git feedback" })]);
    const facts = el("dl", { class: "facts" });
    function fact(k, v) {
      facts.appendChild(el("dt", { text: k }));
      facts.appendChild(el("dd", { text: v }));
    }
    fact("Last published commit", lp && lp.sha ? lp.sha : "Nothing published yet");
    fact("Pushed at", lp && lp.pushedAt ? lp.pushedAt : "Not available");
    fact("Branch", (lp && lp.branch) || s.targetBranch || "main");
    fact("Remote", (lp && lp.remote) || s.remoteDisplay || s.remote || "origin");
    panel.appendChild(facts);
    panel.appendChild(
      el("p", {
        text: "To find the run this publish started, open the Actions page of the repository on GitHub and look for the run whose commit starts with the same first characters as the commit above.",
      }),
    );
    const lines = feedbackLines(feedback.records);
    const text = lines.length ? lines.join("\n") : "No git activity yet.";
    panel.appendChild(el("h4", { id: "git-feedback-label", text: "Git output (read-only)" }));
    panel.appendChild(
      el("pre", { class: "terminal scroll-region", id: "git-feedback", tabindex: "0", role: "region", "aria-labelledby": "git-feedback-label", text: text }),
    );
    return panel;
  }

  async function send(button) {
    if (!lastRequest) return;
    if (button) button.setAttribute("disabled", "disabled");
    ctx.announce("Publishing to GitHub...", true);
    try {
      const r = await api("/api/publish", { body: lastRequest });
      lastFailure = null;
      result.replaceChildren(
        el("p", { text: "Published. Commit " + r.commit + " was pushed to " + r.branch + " at " + r.pushedAt + ". A run starts on GitHub automatically." }),
      );
      ctx.announce("Published to GitHub.", true);
    } catch (e) {
      lastFailure = e && e.message ? e.message : "The publish failed.";
      result.replaceChildren();
      ctx.showAlert(lastFailure);
    }
    try {
      await load();
    } catch (e) {
      ctx.showAlert(e && e.message ? e.message : "Could not refresh the publish status.");
    }
  }

  await load();
}
