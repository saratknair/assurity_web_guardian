// Published-run findings loader for the CSS-3D office.
//
// Reuses the SAME published data the dashboard drill-down uses:
//   ./data/runs/<runId>/findings.json        (pages[] with outcomes + aiItems)
//   ./data/runs/<runId>/screenshots/<slug>.<viewport>[.diff].png
//
// Drives two things, both honest (only real published data, never fabricated):
//   1. The specimen cylinders: one "captured specimen" per finding, coloured by
//      severity (critical/serious/moderate/minor derived from the detail text).
//   2. The agent blow-up inspector: screenshots for the scanner agents, and the
//      findings + AI notes for the analyst agents.
//
// Same-origin relative fetch only; empty/degraded on any error (no throw).

import { useEffect, useState } from "react";

export type Severity = "critical" | "serious" | "moderate" | "minor";
export const SEVERITY_ORDER: Severity[] = ["critical", "serious", "moderate", "minor"];

export interface Outcome {
  findingId?: string;
  kind?: string;
  classification?: string;
  detail: string;
  severity: Severity;
}
export interface AiNote {
  agent?: string;
  label?: string;
  text?: string;
  classification?: string;
}
export interface PageFindings {
  page: string;
  slug: string;
  outcomes: Outcome[];
  aiItems: AiNote[];
  shots: { label: string; url: string }[];
}
export interface Specimen {
  id: string;
  severity: Severity;
  page: string;
  detail: string;
}
export interface RunFindings {
  runId: string | null;
  pages: PageFindings[];
  specimens: Specimen[];
  loaded: boolean;
}

/** Derive one of the canonical severities from an outcome detail string. */
export function severityOf(detail: string): Severity {
  const t = String(detail || "").toLowerCase();
  for (const s of SEVERITY_ORDER) if (t.indexOf(s) !== -1) return s;
  return "minor";
}

function shotUrls(runId: string, slug: string): { label: string; url: string }[] {
  const base = "./data/runs/" + encodeURIComponent(runId) + "/screenshots/";
  return [
    { label: "Desktop", url: base + slug + ".desktop.png" },
    { label: "Desktop (diff)", url: base + slug + ".desktop.diff.png" },
    { label: "Mobile", url: base + slug + ".mobile.png" },
    { label: "Mobile (diff)", url: base + slug + ".mobile.diff.png" },
  ];
}

/**
 * Load the findings for a run and shape them for the office. Returns empty,
 * loaded=true when runId is null or on any fetch/parse error so the scene
 * degrades to "no specimens / no detail" rather than throwing.
 */
export function useRunFindings(runId: string | null): RunFindings {
  const [data, setData] = useState<RunFindings>({ runId, pages: [], specimens: [], loaded: false });

  useEffect(() => {
    let cancelled = false;
    setData({ runId, pages: [], specimens: [], loaded: false });
    if (!runId) {
      setData({ runId: null, pages: [], specimens: [], loaded: true });
      return;
    }
    void (async () => {
      try {
        const res = await fetch("./data/runs/" + encodeURIComponent(runId) + "/findings.json");
        if (!res.ok) throw new Error("findings " + res.status);
        const raw: unknown = await res.json();
        const rawPages = raw && typeof raw === "object" && Array.isArray((raw as { pages?: unknown }).pages)
          ? ((raw as { pages: unknown[] }).pages)
          : [];
        const pages: PageFindings[] = [];
        const specimens: Specimen[] = [];
        for (const rp of rawPages) {
          const p = rp as { page?: unknown; slug?: unknown; outcomes?: unknown; aiItems?: unknown };
          const page = typeof p.page === "string" ? p.page : "(unknown)";
          const slug = typeof p.slug === "string" ? p.slug : "";
          const outcomes: Outcome[] = [];
          if (Array.isArray(p.outcomes)) {
            for (const ro of p.outcomes) {
              const o = ro as { findingId?: string; kind?: string; classification?: string; detail?: unknown };
              const detail = typeof o.detail === "string" ? o.detail : "";
              const sev = severityOf(detail);
              outcomes.push({ findingId: o.findingId, kind: o.kind, classification: o.classification, detail, severity: sev });
              specimens.push({ id: o.findingId || (slug + ":" + specimens.length), severity: sev, page, detail });
            }
          }
          const aiItems: AiNote[] = [];
          if (Array.isArray(p.aiItems)) {
            for (const ra of p.aiItems) {
              const a = ra as AiNote;
              aiItems.push({ agent: a.agent, label: a.label, text: a.text, classification: a.classification });
            }
          }
          pages.push({ page, slug, outcomes, aiItems, shots: slug ? shotUrls(runId, slug) : [] });
        }
        if (!cancelled) setData({ runId, pages, specimens, loaded: true });
      } catch {
        if (!cancelled) setData({ runId, pages: [], specimens: [], loaded: true });
      }
    })();
    return () => { cancelled = true; };
  }, [runId]);

  return data;
}