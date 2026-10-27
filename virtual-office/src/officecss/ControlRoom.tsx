import { useMemo } from "react";
import type { OfficeCharacter } from "../office/stateMachine";
import type { RunFindings, Severity } from "../office/findingsData";
import { SEVERITY_ORDER } from "../office/findingsData";
import { Agent } from "./Agent";
import { MainScreen } from "./MainScreen";

interface Props {
  characters: OfficeCharacter[];
  idle: boolean;
  runId: string | null;
  phase: string;
  findings: RunFindings;
  onInspect: (agentName: string) => void;
}

// How many specimen tubes to show per wall (left/right). Findings beyond this
// are summarised by the status-bar counts; the tubes convey severity at a glance.
const TUBES_PER_WALL = 6;

/**
 * The CSS-3D control room. A fixed-perspective scene (no free camera) built
 * entirely from transformed DIVs - no WebGL. Back wall holds the MainScreen
 * digital twin; side walls hold glass specimen cylinders (one per caught
 * finding, coloured by severity); the floor holds the agents who walk in,
 * work, and leave based ONLY on genuine run events.
 */
export function ControlRoom({ characters, idle, runId, phase, findings, onInspect }: Props) {
  // Split specimens across the two side walls, highest severity first.
  const { left, right } = useMemo(() => splitSpecimens(findings), [findings]);

  // Present characters only (honest): entering/waiting/seated/working.
  const present = characters.filter((c) => c.phase !== "gone" && c.phase !== "leaving" || c.phase === "leaving");

  return (
    <div className="scene">
      <div className="room">
        <div className="room__floor" />
        <div className="room__wall room__wall--back" />
        <div className="room__wall room__wall--left" />
        <div className="room__wall room__wall--right" />
        <div className="room__ceiling" />

        {/* Back wall: the digital-twin main screen */}
        <MainScreen runId={runId} phase={phase} idle={idle} findings={findings} />

        {/* Specimen cylinders on the side walls */}
        <div className="specimens specimens--left">
          {left.map((s, i) => <Tube key={s.id} severity={s.severity} index={i} detail={s.detail} />)}
        </div>
        <div className="specimens specimens--right">
          {right.map((s, i) => <Tube key={s.id} severity={s.severity} index={i} detail={s.detail} />)}
        </div>

        {/* Door at the back corner that agents emerge from */}
        <div className="door" aria-hidden="true"><span /></div>

        {/* Agents on the floor */}
        <div className="agents">
          {present.map((c, i) => (
            <Agent
              key={c.id}
              character={c}
              slot={i}
              total={Math.max(present.length, 1)}
              onClick={() => onInspect(c.agentName)}
            />
          ))}
        </div>

        {idle && (
          <div className="room__idle">Standing by - no active Guardian run</div>
        )}
      </div>
    </div>
  );
}

function Tube({ severity, index, detail }: { severity: Severity; index: number; detail: string }) {
  return (
    <div className={"tube tube--" + severity} style={{ animationDelay: (index * 0.15) + "s" }} title={detail}>
      <div className="tube__glass">
        <div className="tube__fluid" />
        <div className="tube__specimen" />
        <div className="tube__glow" />
      </div>
      <div className="tube__cap tube__cap--top" />
      <div className="tube__cap tube__cap--bottom" />
    </div>
  );
}

function splitSpecimens(findings: RunFindings) {
  // Order by severity so the most severe specimens are most prominent.
  const rank: Record<Severity, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const sorted = [...findings.specimens].sort((a, b) => rank[a.severity] - rank[b.severity]);
  const left: typeof sorted = [];
  const right: typeof sorted = [];
  sorted.forEach((s, i) => {
    if (i % 2 === 0 && left.length < TUBES_PER_WALL) left.push(s);
    else if (right.length < TUBES_PER_WALL) right.push(s);
    else if (left.length < TUBES_PER_WALL) left.push(s);
  });
  return { left, right };
}

export { SEVERITY_ORDER };