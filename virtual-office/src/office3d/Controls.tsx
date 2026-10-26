import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, PointerLockControls } from "@react-three/drei";
import type { PointerLockControls as PLC } from "three-stdlib";
import { Vector3 } from "three";

export type CameraMode = "orbit" | "walk";

// Orbit: click-drag rotate, scroll zoom, right-drag pan. Walk: pointer-lock
// first-person with WASD movement at eye height.
export function Controls({ mode }: { mode: CameraMode }) {
  if (mode === "orbit") {
    return (
      <OrbitControls
        makeDefault
        enablePan
        maxPolarAngle={Math.PI / 2.05}
        minDistance={3}
        maxDistance={60}
        target={[0, 1.2, 0]}
      />
    );
  }
  return <WalkControls />;
}

function WalkControls() {
  const { camera } = useThree();
  const plc = useRef<PLC>(null);
  const keys = useRef<Record<string, boolean>>({});
  const vel = useRef(new Vector3());

  useEffect(() => {
    // Start at a sensible eye-height entry point.
    camera.position.set(0, 1.7, 18);
    const down = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const up = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [camera]);

  useFrame((_s, delta) => {
    const speed = 6 * delta;
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();

    vel.current.set(0, 0, 0);
    if (keys.current["KeyW"] || keys.current["ArrowUp"]) vel.current.add(forward);
    if (keys.current["KeyS"] || keys.current["ArrowDown"]) vel.current.sub(forward);
    if (keys.current["KeyD"] || keys.current["ArrowRight"]) vel.current.add(right);
    if (keys.current["KeyA"] || keys.current["ArrowLeft"]) vel.current.sub(right);
    if (vel.current.lengthSq() > 0) {
      vel.current.normalize().multiplyScalar(speed);
      camera.position.add(vel.current);
    }
    // Clamp to room bounds and keep eye height.
    camera.position.y = 1.7;
    camera.position.x = Math.max(-22, Math.min(22, camera.position.x));
    camera.position.z = Math.max(-20, Math.min(22, camera.position.z));
  });

  return <PointerLockControls ref={plc} />;
}