/**
 * Local-request guard for the Management_Console (pure, no sockets).
 *
 * - `checkLocalRequest` is applied to every state-changing route: Host must be the
 *   loopback address with the console port, Origin (if present) must be the same
 *   loopback origin, Sec-Fetch-Site must not be cross-site / same-site, and the
 *   Content-Type must be application/json.
 * - `checkHostOnly` is the additive hardening for read routes (defeats DNS rebinding).
 *
 * Failure carries only a short internal reason; the HTTP layer returns 403 with no detail.
 */

export interface LocalRequestHeaders {
  host?: string | undefined;
  origin?: string | undefined;
  contentType?: string | undefined;
  secFetchSite?: string | undefined;
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

function allowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

/** Host must be `127.0.0.1:<port>` or `localhost:<port>` (case-insensitive). */
export function checkHostOnly(host: string | undefined, port: number): GuardResult {
  if (typeof host !== "string" || host.length === 0) return { ok: false, reason: "host-missing" };
  return allowedHosts(port).includes(host.toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "host-not-local" };
}

export function checkLocalRequest(h: LocalRequestHeaders, port: number): GuardResult {
  const hostCheck = checkHostOnly(h.host, port);
  if (!hostCheck.ok) return hostCheck;

  if (h.origin !== undefined) {
    const allowed = allowedHosts(port).map((x) => `http://${x}`);
    if (!allowed.includes(h.origin.toLowerCase())) return { ok: false, reason: "origin-not-local" };
  }

  if (h.secFetchSite !== undefined) {
    const s = h.secFetchSite.trim().toLowerCase();
    if (s === "cross-site" || s === "same-site") return { ok: false, reason: "cross-site" };
  }

  if (typeof h.contentType !== "string") return { ok: false, reason: "content-type" };
  const mime = (h.contentType.split(";")[0] ?? "").trim().toLowerCase();
  if (mime !== "application/json") return { ok: false, reason: "content-type" };

  return { ok: true };
}
