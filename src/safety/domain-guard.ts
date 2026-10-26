/**
 * Domain-boundary helpers (Req 13). The system never leaves the approved domain
 * and never navigates external links during the browser workflow.
 */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isApprovedDomain(url: string, approvedDomain: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const approved = approvedDomain.toLowerCase();
  return host === approved || host.endsWith("." + approved);
}

export function isExternal(url: string, approvedDomain: string): boolean {
  return !isApprovedDomain(url, approvedDomain);
}
