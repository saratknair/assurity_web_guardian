// Office -> Dashboard Deep_Link builders. Pure, no DOM, never throw.
// The office lives at /office/, so Dashboard links are relative "../#/...".
// Routes mirror dashboard/lib/route.js: #/run/<runId>, #/page/<slug>,
// #/finding/<runId>/<findingId>, #/visual/<runId>/<slug>/<viewport>.
// Each builder returns null when no Dashboard view can exist (missing parts).

const DASH = "../";

function ok(v) {
  return typeof v === "string" && v.trim() !== "";
}

function vp(v) {
  return v === "desktop" || v === "mobile" ? v : null;
}

/** Dashboard run view. */
export function runLink(runId) {
  return ok(runId) ? DASH + "#/run/" + encodeURIComponent(runId) : null;
}

/** Dashboard page detail view. */
export function pageLink(slug) {
  return ok(slug) ? DASH + "#/page/" + encodeURIComponent(slug) : null;
}

/** Dashboard finding detail view from a finding id. */
export function findingLink(runId, findingId) {
  if (!ok(runId) || !ok(findingId)) return null;
  return DASH + "#/finding/" + encodeURIComponent(runId) + "/" + encodeURIComponent(findingId);
}

/** Dashboard Visual_Comparison for a page and viewport. */
export function visualLink(runId, slug, viewport) {
  if (!ok(runId) || !ok(slug) || !vp(viewport)) return null;
  return DASH + "#/visual/" + encodeURIComponent(runId) + "/" + encodeURIComponent(slug) + "/" + viewport;
}

/**
 * Split a Finding_Key "pageUrl|viewport|ruleId" from the right, so a "|" inside
 * the page URL does not break parsing. Returns null if it is not well formed.
 */
export function parseFindingKey(key) {
  if (typeof key !== "string") return null;
  const b = key.lastIndexOf("|");
  if (b <= 0) return null;
  const a = key.lastIndexOf("|", b - 1);
  if (a <= 0) return null;
  const pageUrl = key.slice(0, a);
  const viewport = key.slice(a + 1, b);
  const ruleId = key.slice(b + 1);
  if (!pageUrl || !vp(viewport) || !ruleId) return null;
  return { pageUrl, viewport, ruleId };
}

/**
 * Dashboard finding link from a Finding_Key. The id comes from the entry's
 * findingIds map (ruleId -> id), or from a plain { ruleId: id } / key -> id map.
 * No id means no published finding, so no link.
 */
export function findingLinkFromKey(runId, key, findingIds) {
  try {
    const parsed = parseFindingKey(key);
    if (!parsed || !findingIds || typeof findingIds !== "object") return null;
    const own = (k) => (Object.prototype.hasOwnProperty.call(findingIds, k) ? findingIds[k] : undefined);
    const id = own(parsed.ruleId) !== undefined ? own(parsed.ruleId) : own(key);
    return findingLink(runId, id);
  } catch (_err) {
    return null;
  }
}

/**
 * Links for every Finding_Key on a timeline entry. Keys without a published id
 * are returned with link: null so the caller shows text only.
 */
export function entryFindingLinks(runId, entry) {
  const out = [];
  try {
    const keys = entry && Array.isArray(entry.findingKeys) ? entry.findingKeys : [];
    for (let i = 0; i < keys.length; i++) {
      const p = parseFindingKey(keys[i]);
      out.push({
        key: keys[i],
        ruleId: p ? p.ruleId : null,
        link: findingLinkFromKey(runId, keys[i], entry.findingIds),
      });
    }
  } catch (_err) {
    return out;
  }
  return out;
}

/**
 * Best Dashboard link for a timeline entry: visual comparison for visual
 * steps, otherwise the page view; null when the entry has no page.
 */
export function entryLink(runId, entry) {
  try {
    if (!entry) return null;
    if (entry.step === "visual-compare") {
      const v = visualLink(runId, entry.slug, entry.viewport);
      if (v) return v;
    }
    return pageLink(entry.slug);
  } catch (_err) {
    return null;
  }
}
