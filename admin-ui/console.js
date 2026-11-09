// Console shell: navigation, lazy section loader, status and alert regions.
import { el, api } from "/assets/lib/dom.js";

const SECTIONS = [
  ["overview", "Overview"],
  ["domain", "Domain"],
  ["urls", "Approved URLs"],
  ["discovery", "Discovery"],
  ["baselines", "Baselines"],
  ["findings", "Findings and decisions"],
  ["publish", "Publish"],
  ["schedule", "Schedule"],
  ["runs", "Runs and logs"],
  ["activity", "Setup activity"],
];

const STATUS_THROTTLE_MS = 5000;
const statusRegion = document.getElementById("status");
const alertRegion = document.getElementById("alert");
const host = document.getElementById("section-host");
const nav = document.getElementById("nav");

let lastStatusAt = 0;
let pendingStatus = null;
let pendingTimer = null;

function writeStatus(message) {
  statusRegion.textContent = message;
  lastStatusAt = Date.now();
}

/** Polite status updates: at most one every 5 seconds, except start and end, which are immediate. */
export function announce(message, edge) {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingStatus = null;
  const wait = lastStatusAt + STATUS_THROTTLE_MS - Date.now();
  if (edge || wait <= 0) {
    writeStatus(message);
    return;
  }
  pendingStatus = message;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    if (pendingStatus !== null) writeStatus(pendingStatus);
    pendingStatus = null;
  }, wait);
}

export function showAlert(message) {
  alertRegion.textContent = message || "";
}

function buildNav() {
  const ul = el("ul");
  for (const [name, label] of SECTIONS) {
    const a = el("a", { href: "#" + name, "data-section": name, text: label });
    ul.appendChild(el("li", null, [a]));
  }
  nav.appendChild(ul);
}

function currentName() {
  const hash = window.location.hash.replace(/^#/, "");
  return SECTIONS.some((s) => s[0] === hash) ? hash : "overview";
}

function markCurrent(name) {
  for (const a of nav.querySelectorAll("a")) {
    if (a.getAttribute("data-section") === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

function errorPanel(label, detail) {
  const panel = el("section", { class: "panel error", "aria-labelledby": "section-title" }, [
    el("h2", { id: "section-title", text: label }),
    el("p", { text: "This section could not be loaded. " + detail }),
  ]);
  return panel;
}

let loadToken = 0;

async function loadSection() {
  const name = currentName();
  const label = SECTIONS.find((s) => s[0] === name)[1];
  const token = ++loadToken;
  markCurrent(name);
  showAlert("");
  host.replaceChildren();
  let mod;
  try {
    mod = await import("/assets/sections/" + name + ".js");
    if (typeof mod.render !== "function") throw new Error("The section has no render function.");
  } catch (e) {
    if (token !== loadToken) return;
    host.replaceChildren(errorPanel(label, e && e.message ? e.message : "Unknown error."));
    document.title = label + " - Assurity Web Guardian Console";
    return;
  }
  if (token !== loadToken) return;
  const section = el("section", { "aria-labelledby": "section-title" }, [el("h2", { id: "section-title", text: label })]);
  host.replaceChildren(section);
  document.title = label + " - Assurity Web Guardian Console";
  try {
    await mod.render(section, { api, el, announce, showAlert });
  } catch (e) {
    if (token !== loadToken) return;
    showAlert(e && e.message ? e.message : "The section failed to load.");
  }
}

buildNav();
window.addEventListener("hashchange", () => {
  loadSection();
  document.getElementById("main").focus();
});
loadSection();
