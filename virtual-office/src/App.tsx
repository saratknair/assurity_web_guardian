import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  useOfficeModel,
  resolveOfficeMode,
  useLatestPublishedRunId,
} from "./office/dataSource";
import { defaultDesks } from "./office/deskManager";
import type { OfficeCharacter } from "./office/stateMachine";
import { CommandCenter, SPAWN_CAMERA_POSITION } from "./office3d/CommandCenter";
import { Human } from "./office3d/Human";
import { BillboardLabel } from "./office3d/BillboardLabel";
import { IntroCinematic } from "./office3d/IntroCinematic";
import { Controls, type CameraMode } from "./office3d/Controls";
import "./office.css";

const DESK_COUNT = 12;
const DOOR_POSITION: [number, number, number] = [-10, 0, -8];

interface PublishedRun {
  runId: string;
  finishedAt?: string;
  status?: string;
  health?: string;
}

// Load the published runs index (newest-first) for the run selector. Static,
// same-origin, relative fetch only; empty list on any error.
function usePublishedRuns(enabled: boolean): PublishedRun[] {
  const [runs, setRuns] = useState<PublishedRun[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!enabled) { setRuns([]); return; }
    void (async () => {
      try {
        const res = await fetch("./data/index.json");
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
  const [revealed, setRevealed] = useState(false);
  const [cam, setCam] = useState<CameraMode>("orbit");

  // Resolved build mode ("replay" on the published site, "live" in local dev).
  const buildMode = resolveOfficeMode();
  const isStatic = buildMode !== "live";

  // Published run list (for the selector) and the chosen run. Defaults to the
  // latest published run; the user can pick any historical run to replay.
  const runs = usePublishedRuns(isStatic);
  const latestRunId = useLatestPublishedRunId(isStatic);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const activeRun = selectedRun ?? latestRunId;

  // On a static site both "replay" and "historical" read the same published
  // JSON; the mode here is purely a UI label. Live mode streams from the local
  // Event_Server. We always derive the office model honestly from events.
  const model = useOfficeModel(buildMode, isStatic ? activeRun : null, DESK_COUNT);

  const desks = useMemo(() => defaultDesks(DESK_COUNT), []);
  const deskPos = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    for (const d of desks) map.set(d.id, d.position);
    return map;
  }, [desks]);

  const scenePhase = useMemo(() => derivePhase(model.characters, model.idle), [model.characters, model.idle]);

  const positionFor = (c: OfficeCharacter): [number, number, number] => {
    if (c.deskId) {
      const p = deskPos.get(c.deskId);
      if (p) return p;
    }
    return DOOR_POSITION;
  };

  const modeLabel = isStatic ? "REPLAY" : "LIVE";

  return (
    <div className="office3d-root">
      <Canvas shadows camera={{ position: SPAWN_CAMERA_POSITION, fov: 55 }}>
        {!revealed && <IntroCinematic onReveal={() => setRevealed(true)} />}

        <CommandCenter runId={model.runId ?? activeRun ?? undefined} phase={scenePhase}>
          {model.characters.map((c) => (
            <group key={c.id} position={positionFor(c)}>
              <Human appearance={c.appearance} phase={c.phase} />
              <BillboardLabel text={c.labelText} />
            </group>
          ))}
        </CommandCenter>

        <Controls mode={cam} />
      </Canvas>

      <div className="hud-top">
        <h1>Assurity Web Guardian - Virtual Office</h1>
        <div className="modes">
          <span className="mode-badge">{modeLabel}</span>
          <span className="cam-toggle">
            <button className={cam === "orbit" ? "active" : ""} onClick={() => setCam("orbit")}>Orbit</button>
            <button className={cam === "walk" ? "active" : ""} onClick={() => setCam("walk")}>Walk</button>
          </span>
        </div>
      </div>

      {isStatic && (
        <div className="hud-runbar">
          <label>
            Run:
            <select
              value={activeRun ?? ""}
              onChange={(e) => setSelectedRun(e.target.value || null)}
            >
              {runs.length === 0 && <option value="">(no published runs)</option>}
              {runs.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {runLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <span className="replay-badge">REPLAY - not live</span>
        </div>
      )}

      <div className="hud-runcontrol">
        <strong>Run Control Board</strong>{" "}
        {model.idle ? (
          <span className="idle-badge">IDLE - no agent activity in this frame</span>
        ) : (
          <span>
            run {model.runId ?? activeRun ?? "-"} - phase {scenePhase} - agents present: {model.characters.length}
          </span>
        )}
      </div>

      {cam === "walk" && (
        <div className="hud-help">Click the scene to look around (Esc to release) - W A S D to move</div>
      )}
    </div>
  );
}

function runLabel(r: PublishedRun): string {
  const when = r.finishedAt ? new Date(r.finishedAt).toLocaleString() : r.runId;
  const status = r.status ? " - " + r.status : "";
  return when + status;
}

function derivePhase(characters: OfficeCharacter[], idle: boolean): string {
  if (idle) return "idle";
  if (characters.some((c) => c.phase === "working")) return "working";
  if (characters.some((c) => c.phase === "seated")) return "seated";
  if (characters.some((c) => c.phase === "waiting")) return "waiting";
  if (characters.some((c) => c.phase === "entering")) return "entering";
  return "idle";
}