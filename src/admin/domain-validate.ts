/**
 * Domain submission validation (Admin_GUI safety — Requirements 10.3, 10.4, 10.5, 10.6,
 * mapped from spec Requirement 11 Acceptance Criteria 3–6).
 *
 * This module is PURE and SYNCHRONOUS: no DNS, no network, no filesystem. It is therefore
 * fully property-testable (validated by Property 17). `validateDomainSubmission` is total —
 * every input string produces a defined `DomainValidation` result and never throws.
 *
 * Scheme policy:
 *   - Only `http:` and `https:` are acceptable schemes. Any other explicit scheme
 *     (ftp:, file:, javascript:, data:, etc.) is rejected.
 *   - A bare host with no scheme (e.g. "assurity.nz" or "careers.assurity.nz/foo") is
 *     acceptable-for-parsing: we normalize it to `https://` before parsing so the host
 *     checks still apply. We prefer/normalize to https rather than inventing http.
 *
 * SSRF note (PoC scope):
 *   Full SSRF protection would RESOLVE the submitted host via DNS and reject any name that
 *   maps to a private/loopback/link-local address. For this proof-of-concept we do NOT do
 *   DNS resolution. Instead we INSPECT the literal host: we reject IP literals that fall in
 *   private/loopback/link-local ranges, reject the hostname "localhost", and — as the
 *   primary boundary — require the host to be inside the approved set. The approved-set
 *   check is the main guarantee; the IP-literal/localhost rejections are defense-in-depth.
 */

/** Host-match semantics shared with src/safety/domain-guard.ts `isApprovedDomain`. */
import { isApprovedDomain } from "../safety/domain-guard.js";

export interface DomainValidation {
  ok: boolean;
  reason?: string;
}

/** Schemes we allow. Everything else is rejected. */
const APPROVED_SCHEMES = new Set(["http:", "https:"]);

/**
 * Validate a user-submitted domain/URL against the approved set.
 *
 * @param input       Raw submitted string (may be a bare host or a full URL).
 * @param approvedSet List of approved apex domains, e.g. ["assurity.nz"]. A host is
 *                    approved iff it equals an approved domain or is a subdomain of one.
 */
export function validateDomainSubmission(
  input: string,
  approvedSet: string[],
): DomainValidation {
  // Total/pure: normalize input defensively.
  const raw = (input ?? "").trim();
  if (raw.length === 0) {
    return { ok: false, reason: "empty input" };
  }

  // Determine whether an explicit scheme is present. A scheme per RFC 3986 looks like
  // `scheme:` where scheme starts with a letter followed by letters/digits/+/-/.
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw);

  let toParse: string;
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase() + ":";
    if (!APPROVED_SCHEMES.has(scheme)) {
      return { ok: false, reason: `scheme not allowed: ${schemeMatch[1]}` };
    }
    toParse = raw;
  } else {
    // No scheme: treat as a bare host and normalize to https (preferred policy).
    toParse = "https://" + raw;
  }

  // Parse the (possibly normalized) URL. Totality: any parse failure is a rejection.
  let url: URL;
  try {
    url = new URL(toParse);
  } catch {
    return { ok: false, reason: "unparseable input" };
  }

  // Re-check scheme after parsing (handles odd inputs the regex let through).
  if (!APPROVED_SCHEMES.has(url.protocol)) {
    return { ok: false, reason: `scheme not allowed: ${url.protocol.replace(/:$/, "")}` };
  }

  const host = url.hostname.toLowerCase();
  if (host.length === 0) {
    return { ok: false, reason: "missing host" };
  }

  // Reject the special-cased loopback name.
  if (host === "localhost") {
    return { ok: false, reason: "loopback host not allowed: localhost" };
  }

  // IPv6 literals are bracketed by URL parsing: new URL("https://[::1]").hostname === "[::1]".
  if (host.startsWith("[") && host.endsWith("]")) {
    const inner = host.slice(1, -1);
    if (isBlockedIPv6(inner)) {
      return { ok: false, reason: `private/loopback IPv6 literal not allowed: ${inner}` };
    }
    // Any other IPv6 literal is still an IP literal, which we reject outright.
    return { ok: false, reason: `IP literal host not allowed: ${inner}` };
  }

  // IPv4 literal? (dotted-quad). Reject all IPv4 literals; flag private/loopback/link-local
  // explicitly for a clearer reason.
  if (isIPv4Literal(host)) {
    if (isBlockedIPv4(host)) {
      return { ok: false, reason: `private/loopback IPv4 literal not allowed: ${host}` };
    }
    return { ok: false, reason: `IP literal host not allowed: ${host}` };
  }

  // Primary boundary: host must be within the approved set (host === approved ||
  // host.endsWith("." + approved)). Reuse isApprovedDomain for identical semantics.
  const approved = approvedSet.some((domain) =>
    isApprovedDomain(url.href, (domain ?? "").toLowerCase()),
  );
  if (!approved) {
    return { ok: false, reason: `host not in approved set: ${host}` };
  }

  return { ok: true };
}

/** True when `host` is a dotted-quad IPv4 literal (0-255 in each octet). */
function isIPv4Literal(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  return m.slice(1).every((o) => {
    const n = Number(o);
    return n >= 0 && n <= 255 && String(n) === String(Number(o));
  });
}

/**
 * True when an IPv4 literal is in a private/loopback/link-local range:
 *   10/8, 172.16/12, 192.168/16, 127/8, 169.254/16.
 */
function isBlockedIPv4(host: string): boolean {
  const parts = host.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  return false;
}

/**
 * True when an IPv6 literal (already unbracketed) is loopback or unique-local:
 *   ::1 (loopback), fc00::/7 (unique local — first byte 0xfc or 0xfd).
 * We also treat IPv4-mapped loopback (::ffff:127.x.x.x) conservatively via the IPv4 check.
 */
function isBlockedIPv6(inner: string): boolean {
  const addr = inner.toLowerCase();
  // Loopback ::1 (allow a leading "::" compressed form only).
  if (addr === "::1") return true;
  // Unique local fc00::/7 — the first hextet's high 7 bits are 1111110, i.e. fc.. or fd..
  const firstHextet = addr.split(":")[0];
  if (/^f[cd]/.test(firstHextet) && firstHextet.length > 0) return true;
  // IPv4-mapped forms like ::ffff:127.0.0.1 — check the embedded IPv4 tail.
  const tail = addr.split(":").pop() ?? "";
  if (isIPv4Literal(tail) && isBlockedIPv4(tail)) return true;
  return false;
}
