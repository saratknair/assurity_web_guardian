import { Billboard, Text } from "@react-three/drei";
import { truncateLabel } from "../office/stateMachine.js";

interface Props {
  /**
   * The agent's name. It is truncated here to at most 24 chars (with a
   * trailing ellipsis when longer) via `truncateLabel`, so passing either a
   * raw name or an already-truncated label is safe (Req 2.7).
   */
  text: string;
  /** Text colour. Defaults to a dark slate that reads on the light plate. */
  color?: string;
  /**
   * Local vertical offset. The parent (task 5.19) places this component's
   * group at the moving character; this `y` lifts the label to just above the
   * head. Defaults to roughly head height.
   */
  y?: number;
}

// Floating name/status label for a moving office character.
//
// Purely presentational: it renders at its own local position and lets the
// parent mount it inside the Human's moving group (task 5.19), so the label
// travels with the character above the head — not above a fixed desk.
//
// drei's <Billboard> re-orients its children every frame so the text always
// faces the active camera. That reorientation happens in a useFrame callback,
// so the label tracks any camera movement within a single frame (<100ms at
// 60fps), satisfying Req 2.8. No hand-rolled quaternion math is needed.
export function BillboardLabel({ text, color = "#0f172a", y = 2.4 }: Props) {
  const label = truncateLabel(text);

  return (
    <Billboard position={[0, y, 0]} follow>
      {/* Subtle background plate for readability against the scene. */}
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[Math.max(0.8, label.length * 0.16 + 0.3), 0.44]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.72} toneMapped={false} />
      </mesh>
      <Text
        fontSize={0.26}
        color={color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.012}
        outlineColor="#ffffff"
      >
        {label}
      </Text>
    </Billboard>
  );
}
