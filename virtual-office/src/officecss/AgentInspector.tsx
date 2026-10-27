import { useEffect } from "react";
import type { OfficeCharacter } from "../office/stateMachine";
import type { RunFindings } from "../office/findingsData";

interface Props {
  character: OfficeCharacter;
  runId: string | null;
  phase: string;
  findings: RunFindings;
  onClose: () => void;
}

// Agents whose work is best shown as the captured SCREENSHOTS of the site.
const SCANNER_AGENTS = /discovery|observation|inventory|axe|accessib/i;

/**
 * Blow-up inspector for a clicked agent. Honest + data-backed:
 *  - Top: that agent's live status (name, role, phase, run).
 *  - Scanner agents (Discovery/Observation/etc): the real page SCREENSHOTS the
 *    run captured - the closest thing to "seeing the screen".
 *  - Analyst agents (Comparator/Quality/Triage/...): the real FINDINGS and the
 *    AI notes produced, with the "not a deterministic fact" labelling for AI.
 * All content comes from the published run data; nothing is fabricated. In
 * replay this is what the agent DID during the completed run.
 */
export function AgentInspector({ character, runId, phase, findings, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isScanner = SCANNER_AGENTS.test(character.agentName);

  // Gather every screenshot across pages (scanner view), and every outcome +
  // ai note (analyst view) from the published findings.
  const allShots = findings.pages.flatMap((p) =>
    p.shots.map((s) => ({ ...s, page: p.page })),
  );
  const allOutcomes = findings.pages.flatMap((p) =>
    p.outcomes.map((o) => ({ ...o, page: p.page })),
  );
  const allNotes = findings.pages.flatMap((p) => p.aiItems);

  return (
    <div className="inspect" role="dialog" aria-modal="true">
      <div className="inspect__overlay" onClick={onClose} />
      <div className="inspect__panel">
        <div className="inspect__head">
          <div>
            <div className="inspect__name">{character.agentName}</div>
            <div className="inspect__meta">
              <span className={"inspect__role role--" + character.role}>{character.role}</span>
              <span>phase: {character.phase}</span>
              <span>run: {runId ?? "-"}</span>
              <span>scene: {phase}</span>
            </div>
          </div>
          <button type="button" className="inspect__close" onClick={onClose} aria-label="Close">Close</button>
        </div>

        <div className="inspect__body">
          {isScanner ? (
            <>
              <h3 className="inspect__sect">What this agent captured</h3>
              {allShots.length === 0 ? (
                <p className="inspect__empty">No screenshots available for this run.</p>
              ) : (
                <div className="inspect__shots">
                  {allShots.map((s, i) => (
                    <figure key={i} className="inspect__shot">
                      <a href={s.url} target="_blank" rel="noopener">
                        <img
                          src={s.url}
                          alt={s.label}
                          loading="lazy"
                          onError={(e) => {
                            const fig = (e.currentTarget as HTMLImageElement).closest("figure");
                            if (fig) (fig as HTMLElement).style.display = "none";
                          }}
                        />
                      </a>
                      <figcaption>{shortPage(s.page)} - {s.label}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <h3 className="inspect__sect">Findings handled</h3>
              {allOutcomes.length === 0 ? (
                <p className="inspect__empty">No findings recorded for this run.</p>
              ) : (
                <ul className="inspect__findings">
                  {allOutcomes.map((o, i) => (
                    <li key={i} className={"finding finding--" + o.severity}>
                      <span className={"sev-badge sev-" + o.severity}>{o.severity}</span>
                      <span className="finding__page">{shortPage(o.page)}</span>
                      <span className="finding__detail">{o.detail}</span>
                    </li>
                  ))}
                </ul>
              )}

              {allNotes.length > 0 && (
                <>
                  <h3 className="inspect__sect">AI-assisted notes</h3>
                  <div className="inspect__notes">
                    {allNotes.slice(0, 12).map((n, i) => (
                      <article key={i} className="ai-note" data-ai="true">
                        <span className="not-a-fact">not a deterministic fact</span>
                        <div className="ai-note__agent">{n.agent || "AI agent"}</div>
                        <p className="ai-note__text">{n.text || ""}</p>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function shortPage(url: string): string {
  try { const u = new URL(url); return u.pathname === "/" ? u.host : u.pathname; } catch { return url; }
}