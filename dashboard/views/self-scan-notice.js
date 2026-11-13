// Footer notice for the automated self-check of this Dashboard (R15.11).
// Reads ./data/self-scan.json (written by CI only). Missing or invalid file
// renders nothing. The count is kept separate from the site totals.

export async function renderSelfScanNotice(footerEl) {
  // The footer no longer shows any accessibility or conformance wording
  // (requirement 19.12). The module is kept so existing imports still work.
  void footerEl;
}
