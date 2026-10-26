import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import type { AgentState } from "../officeState";
import { STATE_COLOR } from "./layout";

interface Props {
  state: AgentState;
  shirt: string;
}

// A stylized low-poly "person" sitting at a desk: head, torso, two upper arms
// and forearms. The forearms bob when the agent is "working" (typing). Pose and
// the small status orb above the head change with state. Purely procedural - no
// external 3D assets, works offline.
export function Character({ state, shirt }: Props) {
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const body = useRef<Group>(null);
  const orb = useRef<Group>(null);

  const isWorking = state === "working" || state === "started";
  const isDown = state === "idle" || state === "skipped" || state === "blocked";
  const isAlert = state === "awaiting_review" || state === "failed";

  useFrame((frameState) => {
    const t = frameState.clock.elapsedTime;
    // Typing: forearms oscillate out of phase when working.
    if (leftArm.current && rightArm.current) {
      const amp = isWorking ? 0.5 : 0;
      leftArm.current.rotation.x = -1.1 + Math.sin(t * 9) * amp;
      rightArm.current.rotation.x = -1.1 + Math.sin(t * 9 + Math.PI) * amp;
    }
    // Body: slumped when idle, upright and gently breathing otherwise;
    // looks up when awaiting review.
    if (body.current) {
      const slump = isDown ? 0.35 : 0;
      const look = isAlert ? -0.25 : 0;
      body.current.rotation.x = slump + look + (isWorking ? Math.sin(t * 2) * 0.02 : 0);
    }
    // Status orb hovers and pulses; bobs faster when alerting.
    if (orb.current) {
      const speed = isAlert ? 6 : 2;
      orb.current.position.y = 1.9 + Math.sin(t * speed) * 0.06;
    }
  });

  const color = STATE_COLOR[state];

  return (
    <group>
      {/* Chair */}
      <mesh position={[0, 0.45, 0.1]} castShadow>
        <boxGeometry args={[0.8, 0.12, 0.8]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[0, 0.9, 0.48]} castShadow>
        <boxGeometry args={[0.8, 0.9, 0.12]} />
        <meshStandardMaterial color="#334155" />
      </mesh>

      {/* Body group (torso + head + arms) pivots at the seat */}
      <group ref={body} position={[0, 0.55, 0.05]}>
        {/* Torso */}
        <mesh position={[0, 0.5, 0]} castShadow>
          <boxGeometry args={[0.7, 0.9, 0.45]} />
          <meshStandardMaterial color={shirt} />
        </mesh>
        {/* Head */}
        <mesh position={[0, 1.2, 0]} castShadow>
          <boxGeometry args={[0.42, 0.42, 0.42]} />
          <meshStandardMaterial color="#e9c6a8" />
        </mesh>
        {/* Hair cap */}
        <mesh position={[0, 1.4, 0]} castShadow>
          <boxGeometry args={[0.46, 0.14, 0.46]} />
          <meshStandardMaterial color="#3b2f2a" />
        </mesh>

        {/* Left arm: upper arm group pivots at shoulder; forearm reaches to desk */}
        <group ref={leftArm} position={[-0.42, 0.78, 0]} rotation={[-1.1, 0, 0]}>
          <mesh position={[0, 0, 0.28]} castShadow>
            <boxGeometry args={[0.18, 0.18, 0.6]} />
            <meshStandardMaterial color={shirt} />
          </mesh>
          <mesh position={[0, -0.05, 0.6]} castShadow>
            <boxGeometry args={[0.16, 0.16, 0.16]} />
            <meshStandardMaterial color="#e9c6a8" />
          </mesh>
        </group>
        <group ref={rightArm} position={[0.42, 0.78, 0]} rotation={[-1.1, 0, 0]}>
          <mesh position={[0, 0, 0.28]} castShadow>
            <boxGeometry args={[0.18, 0.18, 0.6]} />
            <meshStandardMaterial color={shirt} />
          </mesh>
          <mesh position={[0, -0.05, 0.6]} castShadow>
            <boxGeometry args={[0.16, 0.16, 0.16]} />
            <meshStandardMaterial color="#e9c6a8" />
          </mesh>
        </group>
      </group>

      {/* Status orb above the head */}
      <group ref={orb} position={[0, 1.9, 0.05]}>
        <mesh>
          <sphereGeometry args={[0.16, 16, 16]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={isAlert ? 1.2 : 0.6} />
        </mesh>
      </group>
    </group>
  );
}