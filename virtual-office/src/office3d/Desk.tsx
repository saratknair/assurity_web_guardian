import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import type { Mesh, MeshStandardMaterial } from "three";
import type { AgentState } from "../officeState";
import type { DeskLayout } from "./layout";
import { STATE_COLOR, STATE_LABEL, KIND_SHIRT, isProp } from "./layout";
import { Character } from "./Character";

interface Props {
  layout: DeskLayout;
  state: AgentState;
  selected: boolean;
  onSelect: () => void;
}

export function Desk({ layout, state, selected, onSelect }: Props) {
  const [hover, setHover] = useState(false);
  const screen = useRef<MeshStandardMaterial>(null);
  const ring = useRef<Mesh>(null);
  const color = STATE_COLOR[state];
  const shirt = KIND_SHIRT[layout.area.kind];
  const busy = state === "working" || state === "started";
  const prop = isProp(layout.area.id);

  useFrame((frameState) => {
    const t = frameState.clock.elapsedTime;
    if (screen.current) {
      const base = busy ? 0.9 : 0.35;
      screen.current.emissiveIntensity = base + (busy ? Math.sin(t * 12) * 0.15 : 0);
    }
    if (ring.current && selected) ring.current.rotation.z = t * 1.5;
  });

  const [px, , pz] = layout.position;

  return (
    <group
      position={[px, 0, pz]}
      rotation={[0, layout.rotationY, 0]}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
      onPointerOut={() => setHover(false)}
    >
      {prop ? <PropStation area={layout.area.id} hover={hover} /> : (
        <WorkerDesk screen={screen} color={color} shirt={shirt} hover={hover} state={state} />
      )}

      {/* Floating name + status tag */}
      <group position={[0, prop ? 2.9 : 2.5, -0.9]}>
        <Text fontSize={0.26} color="#0f172a" anchorX="center" anchorY="middle" outlineWidth={0.012} outlineColor="#ffffff">
          {layout.area.label}
        </Text>
        <Text position={[0, -0.32, 0]} fontSize={0.2} color={prop ? "#64748b" : color} anchorX="center" anchorY="middle" outlineWidth={0.01} outlineColor="#ffffff">
          {prop ? "store / board" : STATE_LABEL[state]}
        </Text>
      </group>

      {selected && (
        <mesh ref={ring} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.3, 1.5, 32]} />
          <meshBasicMaterial color={prop ? "#64748b" : color} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

function WorkerDesk({ screen, color, shirt, hover, state }: {
  screen: React.RefObject<MeshStandardMaterial>; color: string; shirt: string; hover: boolean; state: AgentState;
}) {
  return (
    <group>
      {/* Desk surface */}
      <mesh position={[0, 1.0, -0.9]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.1, 1.2]} />
        <meshStandardMaterial color={hover ? "#c9b79c" : "#b9a687"} />
      </mesh>
      {[[-1.1, -1.4], [1.1, -1.4], [-1.1, -0.4], [1.1, -0.4]].map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.5, lz]}>
          <boxGeometry args={[0.1, 1.0, 0.1]} />
          <meshStandardMaterial color="#6b5d49" />
        </mesh>
      ))}
      {/* Monitor */}
      <mesh position={[0, 1.15, -1.25]}>
        <boxGeometry args={[0.1, 0.3, 0.1]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
      <mesh position={[0, 1.5, -1.3]} castShadow>
        <boxGeometry args={[1.1, 0.7, 0.08]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
      <mesh position={[0, 1.5, -1.255]}>
        <planeGeometry args={[0.98, 0.58]} />
        <meshStandardMaterial ref={screen} color={color} emissive={color} emissiveIntensity={0.5} toneMapped={false} />
      </mesh>
      {/* Keyboard */}
      <mesh position={[0, 1.06, -0.55]}>
        <boxGeometry args={[0.8, 0.04, 0.3]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      <Character state={state} shirt={shirt} />
    </group>
  );
}

// Furniture for non-agent locations. A filing/shelving unit plus a wall board.
function PropStation({ area, hover }: { area: string; hover: boolean }) {
  const board = area === "RunControl" || area === "HumanReview";
  return (
    <group>
      {board ? (
        <group>
          {/* Standing board on an easel */}
          <mesh position={[0, 1.4, -0.9]} castShadow>
            <boxGeometry args={[1.8, 1.2, 0.1]} />
            <meshStandardMaterial color={hover ? "#f8fafc" : "#eef2f7"} />
          </mesh>
          <mesh position={[0, 1.4, -0.86]}>
            <planeGeometry args={[1.6, 1.0]} />
            <meshStandardMaterial color="#dbe4ef" />
          </mesh>
          <mesh position={[-0.6, 0.7, -0.7]} rotation={[0.2, 0, 0]}><boxGeometry args={[0.08, 1.4, 0.08]} /><meshStandardMaterial color="#8b7355" /></mesh>
          <mesh position={[0.6, 0.7, -0.7]} rotation={[0.2, 0, 0]}><boxGeometry args={[0.08, 1.4, 0.08]} /><meshStandardMaterial color="#8b7355" /></mesh>
        </group>
      ) : (
        <group>
          {/* Filing / archive shelving unit */}
          <mesh position={[0, 0.9, -0.9]} castShadow receiveShadow>
            <boxGeometry args={[1.6, 1.8, 0.8]} />
            <meshStandardMaterial color={hover ? "#9fb0c3" : "#8ea2b8"} />
          </mesh>
          {[0.3, 0.9, 1.5].map((y, i) => (
            <mesh key={i} position={[0, y, -0.49]}>
              <boxGeometry args={[1.4, 0.35, 0.06]} />
              <meshStandardMaterial color="#64748b" />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}