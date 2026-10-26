import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, ContactShadows } from "@react-three/drei";
import { AREAS, deriveSnapshot } from "../officeState";
import { useRuns, useLive, useReplay, useHistorical, type GEvent, type Mode } from "../useGuardianEvents";
import { buildLayout, STATE_COLOR, STATE_LABEL } from "./layout";
import { Desk } from "./Desk";
import { Controls, type CameraMode } from "./Controls";

function Room() {
  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      {/* Carpet zone */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -2]} receiveShadow>
        <planeGeometry args={[40, 34]} />
        <meshStandardMaterial color="#cbd5e1" />
      </mesh>
      {/* Back + side walls */}
      <mesh position={[0, 5, -20]} receiveShadow>
        <boxGeometry args={[60, 10, 0.4]} />
        <meshStandardMaterial color="#f1f5f9" />
      </mesh>
      <mesh position={[-24, 5, 0]} receiveShadow>
        <boxGeometry args={[0.4, 10, 60]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[24, 5, 0]} receiveShadow>
        <boxGeometry args={[0.4, 10, 60]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
    </group>
  );
}

export function Office3D() {
  const runs = useRuns();
  const [mode, setMode] = useState<Mode>("live");
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [speed, setSpeed] = useState(10);
  const [playing, setPlaying] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [cam, setCam] = useState<CameraMode>("orbit");

  const live = useLive(mode === "live");
  const replay = useReplay(mode === "replay" ? selectedRun : null, speed, playing);
  const historical = useHistorical(mode === "historical" ? selectedRun : null);

  const events: GEvent[] = mode === "live" ? live.events : mode === "replay" ? replay.events : historical;
  const snapshot = useMemo(() => deriveSnapshot(events), [events]);
  const isIdle = mode === "live" && live.idle && events.length === 0;

  const layout = useMemo(() => buildLayout(), []);
  const sel = selectedAgent ? snapshot.byAgent[selectedAgent] : null;
  const selArea = AREAS.find((a) => a.id === selectedAgent);

  return (
    <div className="office3d-root">
      {/* ---- 3D scene ---- */}
      <Canvas shadows camera={{ position: [0, 12, 24], fov: 50 }} onPointerMissed={() => setSelectedAgent(null)}>
        <color attach="background" args={["#dbe2ea"]} />
        <fog attach="fog" args={["#dbe2ea", 35, 70]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 18, 8]} intensity={1.1} castShadow shadow-mapSize={[2048, 2048]} />
        <Environment preset="city" />

        <Room />
        {layout.map((l) => (
          <Desk
            key={l.area.id}
            layout={l}
            state={snapshot.byAgent[l.area.id]?.state ?? "idle"}
            selected={selectedAgent === l.area.id}
            onSelect={() => setSelectedAgent(l.area.id)}
          />
        ))}
        <ContactShadows position={[0, 0.02, 0]} opacity={0.35} scale={60} blur={2} far={10} />
        <Controls mode={cam} />
      </Canvas>

      {/* ---- HUD overlay ---- */}
      <div className="hud-top">
        <h1>Assurity Web Guardian - Virtual Office (3D)</h1>
        <div className="modes" role="tablist" aria-label="Office modes">
          {(["live", "historical", "replay"] as const).map((m) => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
          <span className="cam-toggle">
            <button className={cam === "orbit" ? "active" : ""} onClick={() => setCam("orbit")}>Orbit</button>
            <button className={cam === "walk" ? "active" : ""} onClick={() => setCam("walk")}>Walk</button>
          </span>
        </div>
      </div>

      {(mode === "historical" || mode === "replay") && (
        <div className="hud-runbar">
          <label>Run:
            <select value={selectedRun ?? ""} onChange={(e) => setSelectedRun(e.target.value || null)}>
              <option value="">select a completed run...</option>
              {runs.map((r) => <option key={r.runId} value={r.runId}>{r.runId}</option>)}
            </select>
          </label>
          {mode === "replay" && (
            <span className="replay-controls">
              <button onClick={() => setPlaying(true)} disabled={!selectedRun || playing}>Play</button>
              <button onClick={() => setPlaying(false)}>Pause</button>
              <label>Speed
                <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  <option value={1}>1x</option><option value={10}>10x</option><option value={60}>60x</option><option value={600}>600x</option>
                </select>
              </label>
              <span className="replay-badge">REPLAY - not live</span>
            </span>
          )}
        </div>
      )}

      <div className="hud-runcontrol">
        <strong>Run Control Board</strong>{" "}
        {isIdle ? <span className="idle-badge">IDLE - no Guardian run is active</span> : (
          <span>
            run {snapshot.runId ?? "-"} - phase {snapshot.phase ?? "-"} - pending review: {snapshot.pendingReview ? "yes" : "no"} - failed: {snapshot.anyFailed ? "yes" : "no"} - blocked: {snapshot.anyBlocked ? "yes" : "no"}
          </span>
        )}
      </div>

      {cam === "walk" && <div className="hud-help">Click the scene to look around (Esc to release) - W A S D to move</div>}

      {sel && selArea && (
        <aside className="hud-detail">
          <button className="close" onClick={() => setSelectedAgent(null)}>x</button>
          <h2>{selArea.label}</h2>
          <p><strong>Component:</strong> {sel.agent}</p>
          <p><strong>Designation:</strong> {selArea.kind === "ai" ? "AI-assisted" : selArea.kind}</p>
          <p><strong>State:</strong> <span style={{ color: STATE_COLOR[sel.state] }}>{STATE_LABEL[sel.state]}</span></p>
          <p><strong>Latest event:</strong> {sel.latestKind ?? "-"}</p>
          <p><strong>Run ID:</strong> {snapshot.runId ?? "-"}</p>
          <p><strong>Correlation ID:</strong> {snapshot.correlationId ?? "-"}</p>
          <p><strong>Last event time:</strong> {sel.lastEvent?.ts ?? "-"}</p>
          <p className="note">State is derived only from genuine Guardian events. No synthetic activity is shown.</p>
        </aside>
      )}

      <div className="hud-legend">
        {(Object.keys(STATE_LABEL) as (keyof typeof STATE_LABEL)[]).map((s) => (
          <span key={s} className="chip"><i style={{ background: STATE_COLOR[s] }} />{STATE_LABEL[s]}</span>
        ))}
      </div>
    </div>
  );
}