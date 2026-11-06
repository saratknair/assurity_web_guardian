// Footer notice for the automated self-check of this Dashboard (R15.11).
// Reads ./data/self-scan.json (written by CI only). Missing or invalid file
// renders nothing. The count is kept separate from the site totals.

export async function renderSelfScanNotice(footerEl) {
  if (!footerEl) return;
  let data;
  try {
    const res = await fetch("./data/self-scan.json", { cache: "no-store" });
    if (!res.ok) return;
    data = await res.json();
  } catch (e) {
    return;
  }
  const t = data && data.totals;
  if (!t || typeof t.all !== "number") return;
  const serious = (Number(t.critical) || 0) + (Number(t.serious) || 0);
  const p = document.createElement("p");
  p.className = "self-scan-notice";
  p.setAttribute("data-self-scan", "true");
  p.textContent =
    "Automated accessibility self-check of this dashboard: " +
    t.all +
    (t.all === 1 ? " issue" : " issues") +
    " (" +
    serious +
    " critical or serious) on the last build. Automated checks cannot confirm conformance.";
  footerEl.appendChild(p);
}
