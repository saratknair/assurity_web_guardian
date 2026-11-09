// Overview section: domain, usage, unpublished changes, running job, last publish, latest run.
import { usedText, jobText } from "../lib/shell.js";

function text(v, fallback) {
  return typeof v === "string" && v ? v : fallback;
}

function unpublishedText(v) {
  if (v === null || v === undefined) return "Not available yet";
  if (typeof v === "number") return v === 0 ? "None" : v + " changed file" + (v === 1 ? "" : "s");
  if (typeof v === "object" && Number.isFinite(v.count)) return v.count === 0 ? "None" : v.count + " changed files";
  return "Not available yet";
}

const MAX_LISTED = 10;

/** Names of the unpublished files (at most 10), "and N more", and a link to Publish. */
export function unpublishedList(files) {
  const host = document.createElement("div");
  host.id = "overview-unpublished-files";
  if (!Array.isArray(files) || files.length === 0) return host;
  for (const f of files.slice(0, MAX_LISTED)) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = String(f && f.change) + ": " + String(f && f.path);
    host.appendChild(p);
  }
  if (files.length > MAX_LISTED) {
    const more = document.createElement("p");
    more.className = "muted";
    more.textContent = "and " + (files.length - MAX_LISTED) + " more";
    host.appendChild(more);
  }
  const link = document.createElement("a");
  link.setAttribute("href", "#publish");
  link.textContent = "Go to Publish";
  const lp = document.createElement("p");
  lp.appendChild(link);
  host.appendChild(lp);
  return host;
}

function publishTargetText(t) {
  if (!t || !t.remote) return "Not available yet";
  return t.remote + " (" + (t.branch || "main") + ")";
}

function lastPublishText(v) {
  if (!v) return "Not available yet";
  if (typeof v === "string") return v;
  const sha = text(v.sha || v.commit, "");
  const when = text(v.at || v.date, "");
  return [sha ? sha.slice(0, 7) : "", when].filter(Boolean).join(" on ") || "Not available yet";
}

function latestRunText(v) {
  if (!v) return "Not available yet";
  if (typeof v === "string") return v;
  const id = text(v.id || v.runId, "");
  const trigger = text(v.trigger, "");
  return [id, trigger ? "(" + trigger + ")" : ""].filter(Boolean).join(" ") || "Not available yet";
}

function openResultText(label, r) {
  if (r && r.built === false && typeof r.message === "string") return label + ": " + r.message;
  const url = r && typeof r.url === "string" ? r.url : "";
  const launched = !!(r && r.launched === true);
  const where = url ? " Address: " + url + "." : "";
  return (
    label +
    ": " +
    (launched ? "asked this computer to open it in your default browser." : "could not be opened automatically. Open the address yourself.") +
    where
  );
}

/** Views panel: public links (GitHub Pages) and local open buttons (guarded POST routes). */
function viewsPanel(pagesUrl, ctx) {
  const { api, el, announce, showAlert } = ctx;
  const known = typeof pagesUrl === "string" && /^https:\/\/[A-Za-z0-9.-]+\.github\.io\//.test(pagesUrl);
  const panel = el("section", { class: "panel", "aria-labelledby": "views-h" }, [el("h3", { id: "views-h", text: "Views" })]);

  panel.appendChild(el("h4", { text: "Live site (public, on GitHub Pages)" }));
  if (known) {
    const office = pagesUrl.replace(/\/$/, "") + "/office/";
    panel.appendChild(
      el("p", { class: "actions" }, [
        el("a", { class: "button primary", href: pagesUrl, target: "_blank", rel: "noopener noreferrer", text: "Open public Dashboard" }),
        el("a", { class: "button", href: office, target: "_blank", rel: "noopener noreferrer", text: "Open Virtual Office" }),
      ]),
    );
    panel.appendChild(el("p", { class: "muted", text: "Both links open in a new tab. Address: " + pagesUrl }));
  } else {
    panel.appendChild(
      el("p", { text: "The address of the live site is not known, because this project has no GitHub origin remote. No link is shown." }),
    );
  }

  panel.appendChild(el("h4", { text: "On this computer" }));
  panel.appendChild(
    el("p", { class: "muted", text: "These buttons open the views on this computer only. The local Virtual Office needs its dev server to be running." }),
  );
  const result = el("p", { role: "status" });
  const actions = el("p", { class: "actions" });
  for (const [label, path] of [
    ["Open local Dashboard", "/api/open/dashboard"],
    ["Open local Virtual Office", "/api/open/office"],
  ]) {
    const btn = el("button", { type: "button", text: label });
    btn.addEventListener("click", async () => {
      btn.setAttribute("disabled", "disabled");
      showAlert("");
      announce(label + ". Starting.", true);
      try {
        const r = await api(path, { body: {} });
        const msg = openResultText(label, r);
        result.textContent = msg;
        announce(msg, true);
      } catch (e) {
        showAlert(e && e.message ? e.message : label + " failed.");
        announce(label + " failed", true);
      } finally {
        btn.removeAttribute("disabled");
      }
    });
    actions.appendChild(btn);
  }
  panel.appendChild(actions);
  panel.appendChild(result);
  return panel;
}

export async function render(root, ctx) {
  const { api, el, announce } = ctx;
  const body = el("div");
  root.appendChild(body);
  body.appendChild(el("p", { text: "Loading status..." }));
  announce("Loading status", true);

  const [status, domain] = await Promise.all([api("/api/status"), api("/api/domain")]);
  body.replaceChildren();

  body.appendChild(viewsPanel(status && status.pagesUrl, ctx));

  const domainName = text(domain && domain.domain, text(status && status.domain, "Unknown"));
  const baseUrl = text(domain && domain.baseUrl, "");
  const pending = status && status.unpublishedChanges;
  const hasPending = typeof pending === "number" ? pending > 0 : !!pending && (pending.count || 0) > 0;

  const badge = el("span", { class: hasPending ? "badge pending" : "badge", text: hasPending ? "Unpublished changes" : "No unpublished changes" });
  if (pending === null || pending === undefined) badge.textContent = "Unpublished changes: not available yet";

  const dl = el("dl", { class: "facts" }, [
    el("dt", { text: "Domain" }),
    el("dd", { text: baseUrl ? domainName + " (" + baseUrl + ")" : domainName }),
    el("dt", { text: "Approved URLs" }),
    el("dd", { text: text(status && status.used, usedText(0, 10)) }),
    el("dt", { text: "Publishes to" }),
    el("dd", { id: "overview-publish-target", text: publishTargetText(status && status.publishTarget) }),
    el("dt", { text: "Unpublished changes" }),
    el("dd", null, [badge, " ", unpublishedText(pending), unpublishedList(status && status.unpublishedFiles)]),
    el("dt", { text: "Running job" }),
    el("dd", { text: jobText(status && status.runningJob) }),
    el("dt", { text: "Last published commit" }),
    el("dd", { text: lastPublishText(status && status.lastPublish) }),
    el("dt", { text: "Latest run" }),
    el("dd", { text: latestRunText(status && status.latestRun) }),
  ]);
  body.appendChild(el("div", { class: "panel" }, [dl]));
  body.appendChild(el("p", { text: "This console has no AI. Every action is a button." }));
  announce("Status loaded", true);
}
