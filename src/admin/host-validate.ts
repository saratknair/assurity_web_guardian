/**
 * New-domain host validation (design J.3.2; Requirements 21.4, 21.5).
 *
 * SYNTAX ONLY. This module deliberately does NOT consult the current approvedDomain,
 * config/domains/*.json, or any allow-list: choosing the new domain is itself the trust
 * decision. It is pure, total, and never throws.
 */

export type HostValidation =
  | { ok: true; host: string; baseUrl: string; slug: string }
  | { ok: false; reason: string };

const RESERVED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".lan",
  ".home.arpa",
];

const PATH_REASON = "Enter only the site name, for example example.com";

function fail(reason: string): HostValidation {
  return { ok: false, reason };
}

export function validateNewHost(input: string): HostValidation {
  try {
    return validate(typeof input === "string" ? input : "");
  } catch {
    return fail("That is not a valid site name");
  }
}

function validate(input: string): HostValidation {
  const raw = input.trim();
  if (raw.length === 0) return fail("Enter a site name, for example example.com");
  if (raw.length > 2048) return fail("That site name is too long");
  if (/\s/.test(raw)) return fail("A site name cannot contain spaces");

  let rest = raw;
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(rest);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === "http") return fail("Only https sites can be monitored");
    if (scheme !== "https") return fail("Only https sites can be monitored");
    rest = rest.slice(schemeMatch[0].length);
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rest) && !/^[^/?#@]*:\d*(\/|$)/.test(rest)) {
    return fail("Only https sites can be monitored");
  }

  if (rest.includes("?")) return fail(PATH_REASON);
  if (rest.includes("#")) return fail(PATH_REASON);

  const slash = rest.indexOf("/");
  let authority = rest;
  if (slash >= 0) {
    const path = rest.slice(slash);
    if (path !== "/") return fail(PATH_REASON);
    authority = rest.slice(0, slash);
  }

  if (authority.includes("@")) return fail("Do not include a user name or password");
  if (authority.startsWith("[")) return fail("Enter a site name, not an IP address");

  const colon = authority.indexOf(":");
  if (colon >= 0) {
    const port = authority.slice(colon + 1);
    if (port !== "443") return fail("Do not include a port number");
    authority = authority.slice(0, colon);
  }

  if (authority.endsWith(".")) authority = authority.slice(0, -1);
  if (authority.length === 0 || authority.length > 253) {
    return fail("That site name is not valid");
  }

  let host: string;
  try {
    host = new URL("https://" + authority).hostname.toLowerCase();
  } catch {
    return fail("That site name is not valid");
  }
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.length === 0 || host.length > 253) return fail("That site name is not valid");

  if (host === "localhost" || RESERVED_SUFFIXES.some((s) => host.endsWith(s))) {
    return fail("Local and internal names cannot be monitored");
  }

  const labels = host.split(".");
  if (labels.length < 2) return fail("Enter a full site name, for example example.com");
  for (const label of labels) {
    if (!/^[a-z0-9-]{1,63}$/.test(label) || label.startsWith("-") || label.endsWith("-")) {
      return fail("That site name is not valid");
    }
  }
  const last = labels[labels.length - 1];
  const tldOk = /^[a-z]{2,63}$/.test(last) || last.startsWith("xn--");
  if (!tldOk) return fail("Enter a site name, not an IP address");

  const slug = host.replace(/[^a-z0-9]+/g, "-");
  return { ok: true, host, baseUrl: "https://" + host, slug };
}
