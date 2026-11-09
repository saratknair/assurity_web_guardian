// Assurity Web Guardian - run domain helpers ("Different site").
// Plain ES module, ASCII-only, no DOM access, runs under Node.
//
// A run may carry an optional `domain` string (published by the Publisher).
// Legacy runs have none; an unknown domain is never labelled and never breaks
// the trend. Runs are never filtered or rewritten.
//
// Exports
//   runDomain(run)                  trimmed lowercase domain, or "" if unknown.
//   isDifferentSite(run, latest)    true only when both domains are known and
//                                   differ.
//   differentSiteLabel(run, latest) "Different site: <domain>" or "".
//   trendGaps(rows)                 rows oldest first ({domain, dateText?}).
//                                   Returns one gap per boundary between two
//                                   adjacent runs of different KNOWN domains:
//                                   { index, from, to, dateText }, where index
//                                   is the row that starts the new domain.
//   gapNote(gap)                    visible text for one gap.

export const DIFFERENT_SITE_TEXT = "Different site";

export function runDomain(run) {
  if (run === null || typeof run !== "object") return "";
  const d = run.domain;
  return typeof d === "string" ? d.trim().toLowerCase() : "";
}

export function isDifferentSite(run, latest) {
  const a = runDomain(run);
  const b = runDomain(latest);
  return a !== "" && b !== "" && a !== b;
}

export function differentSiteLabel(run, latest) {
  return isDifferentSite(run, latest) ? DIFFERENT_SITE_TEXT + ": " + runDomain(run) : "";
}

export function trendGaps(rows) {
  const out = [];
  const list = Array.isArray(rows) ? rows : [];
  // Compare each run with the previous run whose domain is known, so a legacy
  // run in between does not hide a real change.
  let prevDomain = "";
  for (let i = 0; i < list.length; i++) {
    const d = runDomain(list[i]);
    if (d === "") continue;
    if (prevDomain !== "" && d !== prevDomain) {
      const r = list[i];
      out.push({
        index: i,
        from: prevDomain,
        to: d,
        dateText: r && typeof r.dateText === "string" ? r.dateText : "",
      });
    }
    prevDomain = d;
  }
  return out;
}

export function gapNote(gap) {
  const when = gap.dateText && gap.dateText !== "Date not recorded" ? " on " + gap.dateText.slice(0, 10) : "";
  return "The site changed from " + gap.from + " to " + gap.to + when +
    ". Results before this date describe a different site, so the trend line is broken here.";
}
