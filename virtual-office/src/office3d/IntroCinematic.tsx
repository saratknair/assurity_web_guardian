import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Html, Text } from "@react-three/drei";
import type { Group, MeshStandardMaterial } from "three";

interface Props {
  /**
   * Called exactly once when the reveal animation finishes OR when the
   * Reviewer presses "Skip intro". The parent (task 5.19) owns the camera and
   * uses this signal to hand control to the Spawn_Camera (Req 3.3).
   */
  onReveal: () => void;
  /** Application title shown among the clouds. Has a sensible default. */
  title?: string;
}

// ---------------------------------------------------------------------------
// Intro cinematic (Requirement 3).
//
// PURELY VISUAL. This component is a loading transition only. It renders a
// stylized New Zealand landmass with a soft cloud layer above it and the app
// title set among the clouds (3.1), then tweens the clouds apart + fades them
// out to reveal the command-center office beneath, completing within the
// 2.0–6.0 s window (3.2). When the reveal finishes — or the Reviewer skips —
// it calls `onReveal` exactly once so the parent can place the Spawn_Camera
// (3.3, 3.4).
//
// IMPORTANT (3.5, 3.6): the cinematic sets NO agent state and NO run state. It
// neither creates Office_Characters nor implies any agent activity. Office
// state is derived ONLY from genuine run events by `deriveOffice` elsewhere;
// the cinematic never touches that state, during the animation or after it.
// All it does is render visuals and call `onReveal`.
// ---------------------------------------------------------------------------

// Total reveal duration. Sits comfortably inside the required 2.0–6.0 s window
// (Req 3.2). Hold the full cloud scene briefly, then part + dissolve.
const HOLD_SECONDS = 0.8;
const PART_SECONDS = 2.4;
const REVEAL_SECONDS = HOLD_SECONDS + PART_SECONDS; // 3.2 s total

// Deterministic, offline cloud layout. Soft overlapping spheres read as puffy
// clouds; each is pushed left/right so the layer can visibly part in two.
interface Puff {
  pos: [number, number, number];
  scale: number;
  side: -1 | 1; // which way this puff slides as the clouds part
}

function buildPuffs(): Puff[] {
  // Fixed arrangement (no randomness → stable, no re-layout on re-render).
  const spec: Array<[number, number, number, number]> = [
    // x, y, z, scale
    [-6.5, 2.2, 0, 2.6],
    [-4.2, 3.0, 0.6, 2.1],
    [-2.0, 2.4, -0.4, 1.9],
    [-3.4, 1.6, 0.9, 1.6],
    [-5.6, 3.4, -0.6, 1.7],
    [6.5, 2.2, 0, 2.6],
    [4.2, 3.0, 0.6, 2.1],
    [2.0, 2.4, -0.4, 1.9],
    [3.4, 1.6, 0.9, 1.6],
    [5.6, 3.4, -0.6, 1.7],
  ];
  return spec.map(([x, y, z, scale]) => ({
    pos: [x, y, z],
    scale,
    side: x < 0 ? -1 : 1,
  }));
}

export function IntroCinematic({ onReveal, title = "Assurity Web Guardian — Virtual Office" }: Props) {
  const puffs = useMemo(buildPuffs, []);
  const cloudRefs = useRef<Array<Group | null>>([]);
  const cloudMats = useRef<Array<MeshStandardMaterial | null>>([]);
  const titleRef = useRef<Group>(null);
  const landRef = useRef<Group>(null);

  const elapsed = useRef(0);
  const done = useRef(false); // guard: onReveal fires exactly once
  // Drives unmount of the whole cinematic once the reveal has completed so the
  // overlay stops drawing over the office. Skip sets this immediately too.
  const [finished, setFinished] = useState(false);

  // Fire onReveal at most once, then let the component fade/unmount.
  const reveal = () => {
    if (done.current) return;
    done.current = true;
    setFinished(true);
    onReveal();
  };

  useFrame((_state, delta) => {
    if (done.current) return;
    elapsed.current += delta;
    const t = elapsed.current;

    // Phase 1: hold the full cloud scene so the title is readable.
    const partT = Math.max(0, t - HOLD_SECONDS);
    // Normalized 0→1 progress through the parting/dissolve phase.
    const p = Math.min(1, partT / PART_SECONDS);
    // Ease-in-out for a smooth, cinematic feel.
    const eased = p * p * (3 - 2 * p);

    // Slide each cloud group outward (part) and lift it slightly.
    for (let i = 0; i < cloudRefs.current.length; i++) {
      const g = cloudRefs.current[i];
      if (!g) continue;
      const side = puffs[i].side;
      g.position.x = puffs[i].pos[0] + side * eased * 9;
      g.position.y = puffs[i].pos[1] + eased * 2.5;
    }
    // Dissolve: fade all cloud materials out together.
    for (const m of cloudMats.current) {
      if (m) m.opacity = 0.92 * (1 - eased);
    }
    // Title drifts up and fades with the clouds it sits among.
    if (titleRef.current) {
      titleRef.current.position.y = 4.4 + eased * 1.8;
    }
    // The land sinks away as the office below is revealed.
    if (landRef.current) {
      landRef.current.position.y = -1.2 - eased * 1.5;
    }

    if (t >= REVEAL_SECONDS) reveal();
  });

  // Once revealed/skipped, render nothing: the office beneath takes over and
  // this overlay must not keep drawing on top of it.
  if (finished) return null;

  return (
    <group>
      {/* Soft sky backdrop for the cinematic only (not the office). */}
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 10, 6]} intensity={0.8} />

      {/* Stylized New Zealand "land below": two island silhouettes laid flat.
          Not geographically precise — just readable as land beneath clouds. */}
      <group ref={landRef} position={[0, -1.2, -2]} rotation={[-Math.PI / 2, 0, 0]}>
        <NZLand />
      </group>

      {/* Cloud layer: soft overlapping spheres grouped per puff so each group
          can slide apart as a unit during the parting animation. */}
      {puffs.map((puff, i) => (
        <group
          key={i}
          ref={(g) => {
            cloudRefs.current[i] = g;
          }}
          position={puff.pos}
          scale={puff.scale}
        >
          {/* A few overlapping lobes make each puff look billowy. */}
          {([
            [0, 0, 0, 1],
            [0.7, 0.15, 0.2, 0.75],
            [-0.7, 0.1, -0.2, 0.7],
            [0.1, 0.5, 0.1, 0.6],
          ] as const).map(([lx, ly, lz, ls], j) => (
            <mesh key={j} position={[lx, ly, lz]} scale={ls}>
              <sphereGeometry args={[0.6, 16, 12]} />
              <meshStandardMaterial
                ref={(m) => {
                  // Store one material ref per puff (the first lobe) so the
                  // dissolve fade can address it; extra lobes share the look.
                  if (j === 0) cloudMats.current[i] = m;
                }}
                color="#ffffff"
                transparent
                opacity={0.92}
                roughness={1}
              />
            </mesh>
          ))}
        </group>
      ))}

      {/* App title set AMONG the clouds (3.1). Billboard keeps it facing the
          camera; it drifts up and fades as the clouds part. */}
      <group ref={titleRef} position={[0, 4.4, 1]}>
        <Billboard follow>
          <Text
            fontSize={0.72}
            color="#0f172a"
            anchorX="center"
            anchorY="middle"
            maxWidth={14}
            textAlign="center"
            outlineWidth={0.02}
            outlineColor="#ffffff"
          >
            {title}
          </Text>
        </Billboard>
      </group>

      {/* Visible Skip control (3.4). Rendered via drei <Html> so it overlays
          the Canvas; clicking it reveals the office immediately. */}
      <Html position={[0, 0.4, 2]} center style={{ pointerEvents: "auto" }}>
        <button
          type="button"
          onClick={reveal}
          style={{
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 600,
            color: "#0f172a",
            background: "rgba(255,255,255,0.88)",
            border: "1px solid rgba(15,23,42,0.25)",
            borderRadius: 999,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Skip intro
        </button>
      </Html>
    </group>
  );
}

// Stylized New Zealand: two island-ish blobs. Purely decorative; built from
// primitives so it works offline with no model files. Rendered inside a group
// that the parent rotates flat so the islands lie on the "sea" plane.
function NZLand() {
  return (
    <group>
      {/* North island blob */}
      <mesh position={[1.2, -2.4, 0]} rotation={[0, 0, 0.3]}>
        <capsuleGeometry args={[1.4, 2.6, 6, 16]} />
        <meshStandardMaterial color="#2f7d4f" />
      </mesh>
      {/* South island blob */}
      <mesh position={[-1.4, 1.8, 0]} rotation={[0, 0, -0.2]}>
        <capsuleGeometry args={[1.6, 3.2, 6, 16]} />
        <meshStandardMaterial color="#357f55" />
      </mesh>
    </group>
  );
}
