import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import type { HumanAppearance } from "../office/appearance.js";
import type { CharPhase } from "../office/stateMachine.js";

interface Props {
  appearance: HumanAppearance;
  phase: CharPhase;
  position?: [number, number, number];
}

// Procedural, human-looking 3D character built entirely from primitive meshes
// (capsules / spheres / boxes) — no external model files, works fully offline.
//
// This replaces the old blocky Character.tsx look with a proportioned,
// rounded figure (head, hair, torso, hips, two legs, two arms with forearms
// and hands). Everything is parameterized by `appearance` and posed/animated
// by the lifecycle `phase`. It is purely presentational: appearance + phase ->
// visuals. Path movement (door -> desk) is driven by the parent via `position`
// (task 5.19); here we only play the per-phase procedural animation.
export function Human({ appearance, phase, position = [0, 0, 0] }: Props) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null); // torso + head + arms, pivots at the hips
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const leftLegLower = useRef<Group>(null);
  const rightLegLower = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const leftForearm = useRef<Group>(null);
  const rightForearm = useRef<Group>(null);

  const [sw, sh, st] = appearance.bodyScale; // width, height, limb thickness
  const female = appearance.gender === "female";

  // Gender/build-derived proportions. Females read with a narrower torso,
  // slightly wider hips, and thinner limbs; males with a broader torso and
  // thicker limbs. bodyScale then stretches those base proportions per agent.
  const torsoW = (female ? 0.46 : 0.56) * sw;
  const torsoH = (female ? 0.72 : 0.78) * sh;
  const torsoD = (female ? 0.26 : 0.30) * st;
  const hipW = (female ? 0.42 : 0.44) * sw;
  const shoulderW = (female ? 0.46 : 0.56) * sw;
  const limbR = (female ? 0.075 : 0.09) * st; // arm/leg radius
  const legLen = 0.46 * sh;
  const armLen = 0.34 * sh;
  const headR = 0.17 * ((sw + sh) / 2);
  const skin = appearance.skinTone;
  const shirt = appearance.shirtColor;
  const trouser = appearance.trouserColor;

  const isWalking = phase === "entering" || phase === "leaving";
  const isWaiting = phase === "waiting";
  const isSeated = phase === "seated";
  const isWorking = phase === "working";
  const isGone = phase === "gone";

  // Hip height: standing figures stand on their legs; seated/working figures
  // sit, so the whole rig is lowered toward chair height and legs fold forward.
  const sitting = isSeated || isWorking;
  const hipY = sitting ? 0.52 : legLen + 0.12;

  useFrame((frameState) => {
    const t = frameState.clock.elapsedTime;

    // --- Legs -------------------------------------------------------------
    if (leftLeg.current && rightLeg.current && leftLegLower.current && rightLegLower.current) {
      if (isWalking) {
        // WALK cycle: thighs swing fore/aft out of phase, knees bend on the
        // back-swing so the gait reads as steps.
        const swing = Math.sin(t * 7);
        leftLeg.current.rotation.x = swing * 0.6;
        rightLeg.current.rotation.x = -swing * 0.6;
        leftLegLower.current.rotation.x = Math.max(0, -swing) * 0.7;
        rightLegLower.current.rotation.x = Math.max(0, swing) * 0.7;
      } else if (sitting) {
        // Sitting: thighs forward (horizontal), shins down toward the floor.
        leftLeg.current.rotation.x = -1.45;
        rightLeg.current.rotation.x = -1.45;
        leftLegLower.current.rotation.x = 1.4;
        rightLegLower.current.rotation.x = 1.4;
      } else {
        // Standing idle: straight legs.
        leftLeg.current.rotation.x = 0;
        rightLeg.current.rotation.x = 0;
        leftLegLower.current.rotation.x = 0;
        rightLegLower.current.rotation.x = 0;
      }
    }

    // --- Arms -------------------------------------------------------------
    if (leftArm.current && rightArm.current && leftForearm.current && rightForearm.current) {
      if (isWalking) {
        // Arms swing opposite to the legs for a natural gait.
        const swing = Math.sin(t * 7);
        leftArm.current.rotation.x = -swing * 0.5;
        rightArm.current.rotation.x = swing * 0.5;
        leftForearm.current.rotation.x = 0.2;
        rightForearm.current.rotation.x = 0.2;
      } else if (isWorking) {
        // Seated + typing: upper arms reach forward to the desk, forearms bob
        // out of phase like fingers on a keyboard (mirrors old Character.tsx).
        leftArm.current.rotation.x = -1.15;
        rightArm.current.rotation.x = -1.15;
        leftForearm.current.rotation.x = 0.6 + Math.sin(t * 9) * 0.35;
        rightForearm.current.rotation.x = 0.6 + Math.sin(t * 9 + Math.PI) * 0.35;
      } else if (sitting) {
        // Seated idle: forearms rest forward on the desk, mostly still.
        leftArm.current.rotation.x = -1.1;
        rightArm.current.rotation.x = -1.1;
        leftForearm.current.rotation.x = 0.6;
        rightForearm.current.rotation.x = 0.6;
      } else {
        // Standing: arms hang at the sides.
        leftArm.current.rotation.x = 0;
        rightArm.current.rotation.x = 0;
        leftForearm.current.rotation.x = 0.1;
        rightForearm.current.rotation.x = 0.1;
      }
    }

    // --- Torso ------------------------------------------------------------
    if (body.current) {
      // Subtle breathing/sway while standing and waiting; slight forward lean
      // when working at the desk; neutral otherwise.
      const breathe = isWaiting ? Math.sin(t * 1.6) * 0.03 : 0;
      const lean = isWorking ? 0.15 : sitting ? 0.05 : 0;
      body.current.rotation.x = lean + breathe;
      body.current.rotation.z = isWaiting ? Math.sin(t * 0.9) * 0.02 : 0;
    }
  });

  if (isGone) return null;

  return (
    <group ref={root} position={position} visible={!isGone}>
      {/* Whole rig pivots at the hips. */}
      <group position={[0, hipY, 0]}>
        {/* Hips / pelvis */}
        <mesh castShadow>
          <boxGeometry args={[hipW, 0.22 * sh, torsoD * 1.05]} />
          <meshStandardMaterial color={trouser} />
        </mesh>

        {/* Legs: upper (thigh) group pivots at the hip; lower (shin) group */}
        {/* pivots at the knee. Hands/feet are implicit (shoes = trouser tone). */}
        {([-1, 1] as const).map((side) => {
          const upperRef = side < 0 ? leftLeg : rightLeg;
          const lowerRef = side < 0 ? leftLegLower : rightLegLower;
          const half = legLen / 2;
          return (
            <group key={side} ref={upperRef} position={[side * hipW * 0.32, -0.1 * sh, 0]}>
              {/* Thigh */}
              <mesh position={[0, -half, 0]} castShadow>
                <capsuleGeometry args={[limbR, legLen, 4, 10]} />
                <meshStandardMaterial color={trouser} />
              </mesh>
              {/* Knee -> shin group */}
              <group ref={lowerRef} position={[0, -legLen, 0]}>
                <mesh position={[0, -half, 0]} castShadow>
                  <capsuleGeometry args={[limbR * 0.9, legLen, 4, 10]} />
                  <meshStandardMaterial color={trouser} />
                </mesh>
                {/* Foot */}
                <mesh position={[0, -legLen + 0.02, limbR]} castShadow>
                  <boxGeometry args={[limbR * 2.2, limbR * 1.4, limbR * 3.2]} />
                  <meshStandardMaterial color="#2b2b2b" />
                </mesh>
              </group>
            </group>
          );
        })}

        {/* Body group: torso + head + arms, pivoting just above the hips. */}
        <group ref={body} position={[0, 0.12 * sh, 0]}>
          {/* Torso (rounded via capsule) */}
          <mesh position={[0, torsoH / 2, 0]} castShadow>
            <capsuleGeometry args={[torsoW / 2, torsoH * 0.7, 4, 12]} />
            <meshStandardMaterial color={shirt} />
          </mesh>
          {/* Shoulders cap for a fuller upper body */}
          <mesh position={[0, torsoH * 0.9, 0]} castShadow>
            <sphereGeometry args={[shoulderW / 2, 14, 10]} />
            <meshStandardMaterial color={shirt} />
          </mesh>

          {/* Neck */}
          <mesh position={[0, torsoH + headR * 0.2, 0]} castShadow>
            <cylinderGeometry args={[headR * 0.4, headR * 0.45, headR * 0.6, 10]} />
            <meshStandardMaterial color={skin} />
          </mesh>
          {/* Head */}
          <mesh position={[0, torsoH + headR * 0.9, 0]} castShadow>
            <sphereGeometry args={[headR, 20, 16]} />
            <meshStandardMaterial color={skin} />
          </mesh>
          <Hair style={appearance.hairStyle} color={appearance.hairColor} y={torsoH + headR * 0.9} r={headR} />

          {/* Arms: upper-arm group at the shoulder, forearm group at the elbow */}
          {([-1, 1] as const).map((side) => {
            const upperRef = side < 0 ? leftArm : rightArm;
            const foreRef = side < 0 ? leftForearm : rightForearm;
            const half = armLen / 2;
            return (
              <group
                key={side}
                ref={upperRef}
                position={[side * shoulderW * 0.55, torsoH * 0.85, 0]}
              >
                {/* Upper arm */}
                <mesh position={[0, -half, 0]} castShadow>
                  <capsuleGeometry args={[limbR * 0.85, armLen, 4, 10]} />
                  <meshStandardMaterial color={shirt} />
                </mesh>
                {/* Elbow -> forearm group */}
                <group ref={foreRef} position={[0, -armLen, 0]}>
                  <mesh position={[0, -half, 0]} castShadow>
                    <capsuleGeometry args={[limbR * 0.75, armLen, 4, 10]} />
                    <meshStandardMaterial color={skin} />
                  </mesh>
                  {/* Hand */}
                  <mesh position={[0, -armLen + 0.02, 0]} castShadow>
                    <sphereGeometry args={[limbR * 1.1, 12, 10]} />
                    <meshStandardMaterial color={skin} />
                  </mesh>
                </group>
              </group>
            );
          })}
        </group>
      </group>
    </group>
  );
}

// Hair rendered from primitives, varied by style. "bald" renders nothing;
// "long" adds a fall behind the head; "bun" adds a small knot on top.
function Hair({ style, color, y, r }: { style: HumanAppearance["hairStyle"]; color: string; y: number; r: number }) {
  if (style === "bald") return null;
  return (
    <group position={[0, y, 0]}>
      {/* Cap covering the top/back of the head */}
      <mesh position={[0, r * 0.35, -r * 0.1]} castShadow>
        <sphereGeometry args={[r * 1.08, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {style === "long" && (
        <mesh position={[0, -r * 0.35, -r * 0.55]} castShadow>
          <boxGeometry args={[r * 1.7, r * 1.8, r * 0.6]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
      {style === "bun" && (
        <mesh position={[0, r * 0.95, -r * 0.45]} castShadow>
          <sphereGeometry args={[r * 0.45, 12, 10]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
    </group>
  );
}
