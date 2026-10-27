import { useEffect, useMemo, useState } from "react";
import {
  useOfficeModel,
  resolveOfficeMode,
  useLatestPublishedRunId,
  dataUrl,
} from "./office/dataSource";
import type { OfficeCharacter } from "./office/stateMachine";
import { useRunFindings, SEVERITY_ORDER, type Severity } from "./office/findingsData";
import { ControlRoom } from "./officecss/ControlRoom";
import { AgentInspector } from "./officecss/AgentInspector";
import "./officecss/room.css";

interface PublishedRun {
  runId: string;
  finishedAt?: string;
  status?: string;
  health?: string;
}

function usePublishedRuns(enabled: boolean): PublishedRun[] {
  const [runs, setRuns] = useState<PublishedRun[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!enabled) { setRuns([]); return; }
    void (async () => {
      try {
        const res = await fetch(dataUrl("index.json"));
        if (!res.ok) return;
        const raw: unknown = await res.json();
        const list = Array.isArray(raw)
          ? raw
          : raw && typeof raw === "object" && Array.isArray((raw as { runs?: unknown }).runs)
            ? ((raw as { runs: unknown[] }).runs)
            : [];
        if (!cancelled) setRuns(list as PublishedRun[]);
      } catch { /* selector stays empty */ }
    })();
    return () => { cancelled = true; };
  }, [enabled]);
  return runs;
}

export default function App() {
  const mode = resolveOfficeMode();
  const isStatic = mode !== "live";

  const runs = usePublishedRuns(isStatic);
  const latestRunId = useLatestPublishedRunId(isStatic);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const activeRun = selectedRun ?? latestRunId;

  const model = useOfficeModel(mode, isStatic ? activeRun : null, 12);
  const findings = useRunFindings(isStatic ? activeRun : null);

  // Which agent's blow-up inspector is open (by agentName), or null.
  const [inspect, setInspect] = useState<string | null>(null);
  const inspectChar = inspect ? model.characters.find((c) => c.agentName === inspect) || null : null;

  const phase = useMemo(() => derivePhase(model.characters, model.idle), [model.characters, model.idle]);
  const severityCounts = useMemo(() => countSeverities(findings.specimens), [findings.specimens]);

  const modeLabel = isStatic ? "REPLAY" : "LIVE";

  return (
    <div className="awg-office">
      <ControlRoom
        characters={model.characters}
        idle={model.idle}
        runId={model.runId ?? activeRun ?? null}
        phase={phase}
        findings={findings}
        onInspect={(agentName) => setInspect(agentName)}
      />

      {/* HUD */}
      <div className="hud">
        <div className="hud__brand">
          <span className="hud__dot" />
          <div>
            <div className="hud__title">Assurity Web Guardian</div>
            <div className="hud__sub">Command Center</div>
          </div>
          <span className="hud__mode">{modeLabel}</span>
        </div>

        {isStatic && (
          <label className="hud__run">
            Run
            <select value={activeRun ?? ""} onChange={(e) => setSelectedRun(e.target.value || null)}>
              {runs.length === 0 && <option value="">(no published runs)</option>}
              {runs.map((r) => (
                <option key={r.runId} value={r.runId}>{runLabel(r)}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Status strip */}
      <div className="statusbar">
        {model.idle ? (
          <span className="statusbar__idle">IDLE - no agent activity in this frame</span>
        ) : (
          <span>
            <b>{phase.toUpperCase()}</b> - run {model.runId ?? activeRun ?? "-"} - {model.characters.length} agent(s) active
          </span>
        )}
        <span className="statusbar__specimens">
          {SEVERITY_ORDER.map((s) => (
            <span key={s} className={"sev-dot sev-" + s} title={s}>
              <i /> {severityCounts[s]}
            </span>
          ))}
          <em>contained findings</em>
        </span>
      </div>

      {inspectChar && (
        <AgentInspector
          character={inspectChar}
          runId={model.runId ?? activeRun ?? null}
          phase={phase}
          findings={findings}
          onClose={() => setInspect(null)}
        />
      )}
    </div>
  );
}

function runLabel(r: PublishedRun): string {
  const when = r.finishedAt ? new Date(r.finishedAt).toLocaleString() : r.runId;
  return when + (r.status ? " - " + r.status : "");
}

function derivePhase(characters: OfficeCharacter[], idle: boolean): string {
  if (idle) return "idle";
  if (characters.some((c) => c.phase === "working")) return "working";
  if (characters.some((c) => c.phase === "seated")) return "seated";
  if (characters.some((c) => c.phase === "waiting")) return "waiting";
  if (characters.some((c) => c.phase === "entering")) return "entering";
  return "idle";
}

function countSeverities(specimens: { severity: Severity }[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const s of specimens) out[s.severity]++;
  return out;
}