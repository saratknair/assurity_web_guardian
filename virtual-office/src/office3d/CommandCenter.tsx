import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import type { Group, PointLight } from "three";

// ---------------------------------------------------------------------------
// Command-center scene (task 5.15, Requirements 2.1, 2.9, 2.10)
// ---------------------------------------------------------------------------
//
// A NASA / Men-in-Black-style control room that replaces the old flat desk
// grid. It is a *shell*: it renders the room geometry, the big emissive screen
// wall, and the dynamic lighting, then wraps `children` (the desks + Human
// characters placed by the App wiring in task 5.19).
//
// Everything is built from primitive meshes + standard materials so the office
// stays fully offline with no external assets. Emissive materials give the
// screens and light strips their glow; fog + an ambient glow provide the dark,
// atmospheric command-center mood.
//
// The room is sized to comfortably contain the default ~12-desk grid from
// `office/deskManager.defaultDesks()` (4 columns × 3 rows, ~7 m wide × ~5 m
// deep) with walking space around it. Desks face the back wall (−Z) where the
// screens live, so seated characters look toward the displays.

// Interior half-extents (metres). The floor/walls are built from these so the
// spawn camera and walk-controls bounds stay in sync with the geometry.
const ROOM_HALF_W = 12; // room spans x ∈ [−12, 12]
const ROOM_HALF_D = 10; // room spans z ∈ [−10, 10]; back wall at z = −10
const WALL_H = 8; // interior height

/**
 * Spawn camera position (Requirement 2.9): the top-back corner of the room so
 * the whole office is visible on load (and after the intro cinematic reveal).
 * The App (task 5.19) sets the Canvas `camera.position` to this and aims it at
 * {@link SPAWN_CAMERA_TARGET}.
 *
 * "Back" is the screen wall at −Z; the camera sits high, pulled back past the
 * open front edge and to one side, giving a diagonal overview of the desks and
 * the glowing screen wall beyond them.
 */
export const SPAWN_CAMERA_POSITION: [number, number, number] = [
  -(ROOM_HALF_W - 1), // left side, just inside the wall
  WALL_H - 1, // high up near the ceiling
  ROOM_HALF_D + 5, // pulled back past the open front edge
];

/** Point the spawn camera looks at — the centre of the room, head height. */
export const SPAWN_CAMERA_TARGET: [number, number, number] = [0, 1.2, 0];

interface Props {
  /** Current run id, rendered onto the big screen wall when present. */
  runId?: string;
  /** Current run phase, rendered onto the big screen wall when present. */
  phase?: string;
  /** Desks + characters placed by the App wiring (task 5.19). */
  children?: ReactNode;
}

/**
 * Command-center room shell. Renders the environment + lighting and wraps the
 * supplied `children` (desks/characters). Accepts `{ runId, phase }` which are
 * shown on the central screen panel.
 */
export function CommandCenter({ runId, phase, children }: Props) {
  // Overall-run accent: a subtle colour wash keyed to run state. Neutral cyan
  // when idle, amber-ish while a phase is active.
  const active = Boolean(runId || phase);
  const accent = active ? "#38bdf8" : "#1e40af";

  return (
    <group>
      {/* Atmosphere: dark background + fog + a low ambient glow. */}
      <color attach="background" args={["#05070d"]} />
      <fog attach="fog" args={["#05070d", 18, 46]} />
      <ambientLight intensity={0.25} color="#5b6b8c" />

      {/* A central overhead fill so the floor reads without washing out. */}
      <hemisphereLight args={["#223049", "#02030a", 0.4]} />

      <RoomShell accent={accent} />
      <ScreenWall runId={runId} phase={phase} accent={accent} />
      <DynamicLights accent={accent} active={active} />

      {/* Desks + characters (placed by task 5.19). */}
      {children}
    </group>
  );
}

// Dark, slightly reflective room: floor, back screen wall backing, side walls,
// and a ceiling to close the box so the overhead lights have something to key
// off. Reflectivity is approximated with a low-roughness / metalness floor
// (keeps it cheap — no reflection probes or extra render passes).
function RoomShell({ accent }: { accent: string }) {
  return (
    <group>
      {/* Dark reflective floor. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_HALF_W * 2, ROOM_HALF_D * 2]} />
        <meshStandardMaterial color="#0a0f1a" metalness={0.85} roughness={0.25} />
      </mesh>

      {/* Glowing trim strip let into the floor around the desk pit. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[ROOM_HALF_W - 2.2, ROOM_HALF_W - 2.0, 48]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>

      {/* Back wall (behind the screens). */}
      <mesh position={[0, WALL_H / 2, -ROOM_HALF_D]} receiveShadow>
        <boxGeometry args={[ROOM_HALF_W * 2, WALL_H, 0.3]} />
        <meshStandardMaterial color="#0c121f" metalness={0.5} roughness={0.6} />
      </mesh>

      {/* Side walls. */}
      <mesh position={[-ROOM_HALF_W, WALL_H / 2, 0]} receiveShadow>
        <boxGeometry args={[0.3, WALL_H, ROOM_HALF_D * 2]} />
        <meshStandardMaterial color="#0b111d" metalness={0.5} roughness={0.6} />
      </mesh>
      <mesh position={[ROOM_HALF_W, WALL_H / 2, 0]} receiveShadow>
        <boxGeometry args={[0.3, WALL_H, ROOM_HALF_D * 2]} />
        <meshStandardMaterial color="#0b111d" metalness={0.5} roughness={0.6} />
      </mesh>

      {/* Ceiling with a couple of recessed glowing light bars. */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, WALL_H, 0]}>
        <planeGeometry args={[ROOM_HALF_W * 2, ROOM_HALF_D * 2]} />
        <meshStandardMaterial color="#070b14" metalness={0.3} roughness={0.8} side={2} />
      </mesh>
      {[-ROOM_HALF_D / 2.5, ROOM_HALF_D / 2.5].map((z, i) => (
        <mesh key={i} position={[0, WALL_H - 0.1, z]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[ROOM_HALF_W * 1.4, 0.4]} />
          <meshStandardMaterial color="#cfe6ff" emissive="#9ecbff" emissiveIntensity={0.9} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

// The command-center hallmark: a bank of big glowing display panels on the back
// wall. A wide central panel carries the run id / phase readout; flanking
// panels are abstract glowing displays.
function ScreenWall({ runId, phase, accent }: { runId?: string; phase?: string; accent: string }) {
  const z = -ROOM_HALF_D + 0.2; // just in front of the back wall
  const y = WALL_H * 0.55;

  return (
    <group>
      {/* Central large screen with the run readout. */}
      <mesh position={[0, y, z]}>
        <planeGeometry args={[9, 3.4]} />
        <meshStandardMaterial color="#04121f" emissive={accent} emissiveIntensity={0.55} toneMapped={false} />
      </mesh>
      {/* Thin bezel. */}
      <mesh position={[0, y, z - 0.05]}>
        <planeGeometry args={[9.4, 3.8]} />
        <meshStandardMaterial color="#04070e" />
      </mesh>

      {/* Run readout text rendered onto the central screen. */}
      <Text
        position={[0, y + 0.8, z + 0.02]}
        fontSize={0.7}
        color="#dff2ff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor={accent}
      >
        ASSURITY WEB GUARDIAN
      </Text>
      <Text
        position={[0, y - 0.25, z + 0.02]}
        fontSize={0.5}
        color={accent}
        anchorX="center"
        anchorY="middle"
      >
        {`RUN ${runId ?? "—"}`}
      </Text>
      <Text
        position={[0, y - 1.0, z + 0.02]}
        fontSize={0.42}
        color="#9fc6e8"
        anchorX="center"
        anchorY="middle"
      >
        {`PHASE ${phase ?? "idle"}`}
      </Text>

      {/* Flanking glowing side panels. */}
      {([-1, 1] as const).map((side) => (
        <group key={side} position={[side * 6.6, y, z]}>
          <mesh>
            <planeGeometry args={[3.2, 3.0]} />
            <meshStandardMaterial color="#061826" emissive={accent} emissiveIntensity={0.4} toneMapped={false} />
          </mesh>
          {/* A few glowing "data" bars on the side panels. */}
          {[0.9, 0.3, -0.3, -0.9].map((by, i) => (
            <mesh key={i} position={[0, by, 0.02]}>
              <planeGeometry args={[2.4, 0.18]} />
              <meshStandardMaterial
                color={accent}
                emissive={accent}
                emissiveIntensity={0.9 + i * 0.1}
                toneMapped={false}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// A handful of coloured point/spot lights that give the room its dynamic,
// cinematic feel. The central light gently pulses when a run is active so the
// space feels "live" without inventing any run state (it keys off props only).
function DynamicLights({ accent, active }: { accent: string; active: boolean }) {
  const pulse = useRef<PointLight>(null);
  const rig = useRef<Group>(null);

  useFrame((frameState) => {
    const t = frameState.clock.elapsedTime;
    if (pulse.current) {
      const base = active ? 2.2 : 1.1;
      pulse.current.intensity = base + (active ? Math.sin(t * 3) * 0.6 : Math.sin(t * 0.8) * 0.2);
    }
    // Slow sweep of the accent rig for subtle motion.
    if (rig.current) rig.current.rotation.y = Math.sin(t * 0.15) * 0.25;
  });

  return (
    <group>
      {/* Key light from high front, aimed at the desks. */}
      <spotLight
        position={[0, WALL_H - 0.5, ROOM_HALF_D - 2]}
        angle={0.7}
        penumbra={0.6}
        intensity={2.4}
        color="#cfe0ff"
        castShadow
        shadow-mapSize={[1024, 1024]}
      />

      {/* Accent uplight glowing off the screen wall. */}
      <pointLight ref={pulse} position={[0, 3.2, -ROOM_HALF_D + 2]} intensity={1.6} color={accent} distance={28} />

      {/* Two coloured rim lights in the back corners for depth. */}
      <group ref={rig}>
        <pointLight position={[-ROOM_HALF_W + 2, 3, -ROOM_HALF_D + 2]} intensity={1.0} color="#7c3aed" distance={22} />
        <pointLight position={[ROOM_HALF_W - 2, 3, -ROOM_HALF_D + 2]} intensity={1.0} color="#0ea5e9" distance={22} />
      </group>
    </group>
  );
}
