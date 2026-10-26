import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { useOfficeModel } from "./office/dataSource";
import { defaultDesks } from "./office/deskManager";
import type { OfficeCharacter } from "./office/stateMachine";
import { CommandCenter, SPAWN_CAMERA_POSITION } from "./office3d/CommandCenter";
import { Human } from "./office3d/Human";
import { BillboardLabel } from "./office3d/BillboardLabel";
import { IntroCinematic } from "./office3d/IntroCinematic";
import { Controls, type CameraMode } from "./office3d/Controls";
import "./office.css";

// Number of desks in the command-center room (matches defaultDesks default and
// the model's deskCount so desk ids line up between the reducer and the scene).
const DESK_COUNT = 12;

// Door / spawn point at the top-back corner of the room. Characters that are
// entering or waiting (no desk assigned yet) are placed here so they read as
// "arriving from the door at the back" before a free desk seats them.
const DOOR_POSITION: [number, number, number] = [-10, 0, -8];

/**
 * Office App tree (task 5.19).
 *
 * Composition: a single `<Canvas>` whose camera spawns at
 * `SPAWN_CAMERA_POSITION` (the top-back corner framing the whole room, Req
 * 2.9). The `IntroCinematic` (clouds over NZ, Req 3.1) plays first and hands
 * off via `onReveal`; the `CommandCenter` scene (Req 2.1) renders the office
 * and one `Human` + `BillboardLabel` per character.
 *
 * HONESTY (Req 2.11): characters are rendered ONLY from `model.characters`,
 * which `useOfficeModel` derives from genuine Guardian events via `deriveOffice`.
 * Nothing here invents a character. When the office is idle/empty no characters
 * render, and an honest idle indicator is shown.
 */
export default function App() {
  const [revealed, setRevealed] = useState(false);
  const [cam, setCam] = useState<CameraMode>("orbit");

  // Default local dev = live SSE against the read-only Event_Server (:7788).
  const model = useOfficeModel("live", null, DESK_COUNT);

  // Desk placements, looked up by a character's assigned deskId to seat them.
  const desks = useMemo(() => defaultDesks(DESK_COUNT), []);
  const deskPos = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    for (const d of desks) map.set(d.id, d.position);
    return map;
  }, [desks]);

  // Scene phase shown on the command-center screen wall — derived only from the
  // honest model, never invented. Reflects whether any present character works.
  const scenePhase = useMemo(() => derivePhase(model.characters, model.idle), [model.characters, model.idle]);

  // World position for a character: at its desk when seated, else at the door.
  const positionFor = (c: OfficeCharacter): [number, number, number] => {
    if (c.deskId) {
      const p = deskPos.get(c.deskId);
      if (p) return p;
    }
    return DOOR_POSITION;
  };

  return (
    <div className="office3d-root">
      <Canvas shadows camera={{ position: SPAWN_CAMERA_POSITION, fov: 50 }}>
        {/* Intro cinematic plays first; it unmounts itself on reveal/skip and
            sets no agent/run state. The office renders underneath from the
            start so the reveal hands straight off to the spawn-framed room. */}
        {!revealed && <IntroCinematic onReveal={() => setRevealed(true)} />}

        <CommandCenter runId={model.runId} phase={scenePhase}>
          {/* One Human per genuine character. The BillboardLabel is mounted
              INSIDE the same positioned group so the name floats above that
              specific agent's head and faces the active camera (Req 2.7/2.8). */}
          {model.characters.map((c) => (
            <group key={c.id} position={positionFor(c)}>
              <Human appearance={c.appearance} phase={c.phase} />
              <BillboardLabel text={c.labelText} />
            </group>
          ))}
        </CommandCenter>

        {/* Retain orbit + first-person walk controls (Req 2.10). */}
        <Controls mode={cam} />
      </Canvas>

      {/* Minimal HUD: camera toggle + honest idle indicator. */}
      <div className="hud-top">
        <h1>Assurity Web Guardian — Virtual Office</h1>
        <div className="modes">
          <span className="cam-toggle">
            <button className={cam === "orbit" ? "active" : ""} onClick={() => setCam("orbit")}>Orbit</button>
            <button className={cam === "walk" ? "active" : ""} onClick={() => setCam("walk")}>Walk</button>
          </span>
        </div>
      </div>

      <div className="hud-runcontrol">
        <strong>Run Control Board</strong>{" "}
        {model.idle ? (
          <span className="idle-badge">IDLE — no Guardian run is active</span>
        ) : (
          <span>
            run {model.runId ?? "—"} — phase {scenePhase} — agents present: {model.characters.length}
          </span>
        )}
      </div>

      {cam === "walk" && (
        <div className="hud-help">Click the scene to look around (Esc to release) — W A S D to move</div>
      )}
    </div>
  );
}

/**
 * Derive the scene phase label from the honest model only. Never fabricates
 * activity: "idle" when nothing is present, otherwise reflects the busiest
 * present phase so the screen wall tells the truth about the run.
 */
function derivePhase(characters: OfficeCharacter[], idle: boolean): string {
  if (idle) return "idle";
  if (characters.some((c) => c.phase === "working")) return "working";
  if (characters.some((c) => c.phase === "seated")) return "seated";
  if (characters.some((c) => c.phase === "waiting")) return "waiting";
  if (characters.some((c) => c.phase === "entering")) return "entering";
  return "idle";
}
