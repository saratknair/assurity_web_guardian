// Published-data access for the office replay. Read-only, same-origin, no DOM at import.
// Layout (site root): data/index.json, data/runs/<id>/events.json,
// data/runs/<id>/run-findings.json, data/runs/<id>/screenshots/<slug>.<viewport>.png

// /office/lib/data.js -> /data/ (also works under /local-dashboard/office/lib/).
export const DATA_BASE = new URL("../../data/", import.meta.url);

function bad(rel) {
  return new Error("Invalid published data path: " + (rel === "" || rel == null ? "(empty)" : String(rel)));
}

/**
 * Resolve a path relative to the data folder. Throws on empty paths, "." / ".."
 * or empty segments, backslashes, colons (schemes), control characters, and any
 * result that leaves the base origin or folder. Segments are URI-encoded.
 */
export function dataUrl(rel, base = DATA_BASE) {
  if (typeof rel !== "string" || rel === "") throw bad(rel);
  if (rel.includes("\\") || rel.includes(":") || /[\u0000-\u001f\u007f]/.test(rel)) throw bad(rel);
  const segs = rel.split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..")) throw bad(rel);
  const root = base instanceof URL ? base : new URL(String(base));
  const out = new URL(segs.map(encodeURIComponent).join("/"), root);
  if (out.origin !== root.origin || !out.pathname.startsWith(root.pathname)) throw bad(rel);
  return out.href;
}

/** Fetch and parse one published JSON file. Errors always name the file. */
export async function loadPublished(rel, base = DATA_BASE) {
  const url = dataUrl(rel, base);
  let res;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (err) {
    throw new Error("Could not load " + rel + ": network error");
  }
  if (!res.ok) throw new Error("Could not load " + rel + ": HTTP " + res.status);
  try {
    return await res.json();
  } catch (err) {
    throw new Error("Could not load " + rel + ": the file is not valid JSON");
  }
}

function part(v, what) {
  if (typeof v !== "string" || v === "" || v.includes("/")) {
    throw new Error("Invalid " + what + ": " + (v === "" || v == null ? "(empty)" : String(v)));
  }
  return v;
}

export function loadIndex(base) {
  return loadPublished("index.json", base);
}

export function loadEvents(runId, base) {
  return loadPublished("runs/" + part(runId, "run id") + "/events.json", base);
}

export function loadRunFindings(runId, base) {
  return loadPublished("runs/" + part(runId, "run id") + "/run-findings.json", base);
}

/** Screenshot URL for a page and viewport of a run (may not exist if images were pruned). */
export function imageUrl(runId, slug, viewport, base) {
  const rel = "runs/" + part(runId, "run id") + "/screenshots/" +
    part(slug, "slug") + "." + part(viewport, "viewport") + ".png";
  return dataUrl(rel, base);
}
