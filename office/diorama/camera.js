// Camera rig: bounds, target clamp, fly-to, keyboard setters.
// Pure math is exported without importing three. The three.js and
// OrbitControls modules are loaded lazily inside createCameraRig only.
// Requirements 6.1 to 6.5, 6.7, 6.8.

export const BOUNDS = Object.freeze({
  minDistance: 6,
  maxDistance: 30,
  minPolar: 0.3,
  maxPolar: 1.35,
  targetRadius: 8,
});
export const FOV = 45;
export const FLY_MS = 600;
export const DEFAULT_POSE = Object.freeze({ tx: 0, ty: 0, tz: 0, distance: 20, azimuth: 0.6, polar: 1.0 });
export const KEY_STEPS = Object.freeze({ orbit: 0.12, zoom: 2, pan: 1 });

const TWO_PI = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Clamp target to a circle of targetRadius around the origin (x/z plane); y fixed in [0, 2].
export function clampTarget(t, radius) {
  const r = typeof radius === "number" ? radius : BOUNDS.targetRadius;
  let x = t.tx, z = t.tz;
  const len = Math.sqrt(x * x + z * z);
  if (len > r) {
    x = (x / len) * r;
    z = (z / len) * r;
  }
  return { tx: x, ty: clamp(t.ty, 0, 2), tz: z };
}

// Enforce every Camera_Bound on a pose { tx, ty, tz, distance, azimuth, polar }.
export function clampPose(p) {
  const tg = clampTarget(p);
  return {
    tx: tg.tx,
    ty: tg.ty,
    tz: tg.tz,
    distance: clamp(p.distance, BOUNDS.minDistance, BOUNDS.maxDistance),
    azimuth: p.azimuth,
    polar: clamp(p.polar, BOUNDS.minPolar, BOUNDS.maxPolar),
  };
}

// Camera world position for a pose (spherical around target, y up).
export function poseToPosition(p) {
  const s = Math.sin(p.polar);
  return {
    x: p.tx + p.distance * s * Math.sin(p.azimuth),
    y: p.ty + p.distance * Math.cos(p.polar),
    z: p.tz + p.distance * s * Math.cos(p.azimuth),
  };
}

export function positionToPose(pos, target) {
  const dx = pos.x - target.x, dy = pos.y - target.y, dz = pos.z - target.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
  return {
    tx: target.x, ty: target.y, tz: target.z,
    distance,
    azimuth: Math.atan2(dx, dz),
    polar: Math.acos(clamp(dy / distance, -1, 1)),
  };
}

// Keyboard setters: each returns a new clamped pose.
export function orbitBy(p, dAzimuth, dPolar) {
  return clampPose({ ...p, azimuth: p.azimuth + dAzimuth, polar: p.polar + dPolar });
}

export function zoomBy(p, deltaDistance) {
  return clampPose({ ...p, distance: p.distance + deltaDistance });
}

// Pan in the camera's ground-plane frame: right = +dx, forward = +dz (away from camera).
export function panBy(p, dRight, dForward) {
  const sa = Math.sin(p.azimuth), ca = Math.cos(p.azimuth);
  // Right vector on the ground plane for a camera at azimuth a looking at the target.
  const rx = ca, rz = -sa;
  const fx = -sa, fz = -ca;
  return clampPose({ ...p, tx: p.tx + rx * dRight + fx * dForward, tz: p.tz + rz * dRight + fz * dForward });
}

// Maps a key to an action description, or null. Only meaningful while focus is in the Diorama.
export function keyToCameraAction(key, shiftKey) {
  const shift = !!shiftKey;
  switch (key) {
    case "ArrowLeft": return shift ? { type: "pan", right: -KEY_STEPS.pan, forward: 0 } : { type: "orbit", az: -KEY_STEPS.orbit, pol: 0 };
    case "ArrowRight": return shift ? { type: "pan", right: KEY_STEPS.pan, forward: 0 } : { type: "orbit", az: KEY_STEPS.orbit, pol: 0 };
    case "ArrowUp": return shift ? { type: "pan", right: 0, forward: KEY_STEPS.pan } : { type: "orbit", az: 0, pol: -KEY_STEPS.orbit };
    case "ArrowDown": return shift ? { type: "pan", right: 0, forward: -KEY_STEPS.pan } : { type: "orbit", az: 0, pol: KEY_STEPS.orbit };
    case "+":
    case "=": return { type: "zoom", delta: -KEY_STEPS.zoom };
    case "-":
    case "_": return { type: "zoom", delta: KEY_STEPS.zoom };
    case "0": return { type: "reset" };
    default: return null;
  }
}

export function applyCameraAction(p, action, home) {
  if (!action) return p;
  if (action.type === "orbit") return orbitBy(p, action.az, action.pol);
  if (action.type === "zoom") return zoomBy(p, action.delta);
  if (action.type === "pan") return panBy(p, action.right, action.forward);
  if (action.type === "reset") return clampPose(home || DEFAULT_POSE);
  return p;
}

// Framing pose for a Station anchor {x, z}: behind and to the right of the figure,
// on the centre side, looking outward over its shoulder at the Station screen.
export function framingPose(anchor) {
  const len = Math.sqrt(anchor.x * anchor.x + anchor.z * anchor.z);
  const ox = len > 0 ? anchor.x / len : 0;
  const oz = len > 0 ? anchor.z / len : 1;
  const rx = -oz, rz = ox; // right-hand side for a viewer looking outward
  const pos = { x: anchor.x - ox * 2.5 + rx * 1.8, y: 4.2, z: anchor.z - oz * 2.5 + rz * 1.8 };
  return clampPose(positionToPose(pos, { x: anchor.x + ox * 3, y: 2.2, z: anchor.z + oz * 3 }));
}

export function easeInOut(t) {
  const c = clamp(t, 0, 1);
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

function shortestAngleDelta(from, to) {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

// Interpolate between poses at progress t in [0, 1] (eased). Result is clamped.
export function interpolatePose(a, b, t) {
  const k = easeInOut(t);
  return clampPose({
    tx: a.tx + (b.tx - a.tx) * k,
    ty: a.ty + (b.ty - a.ty) * k,
    tz: a.tz + (b.tz - a.tz) * k,
    distance: a.distance + (b.distance - a.distance) * k,
    azimuth: a.azimuth + shortestAngleDelta(a.azimuth, b.azimuth) * k,
    polar: a.polar + (b.polar - a.polar) * k,
  });
}

// Tween state machine (pure). flyTo with instant=true (Reduced_Motion) jumps.
export function startFly(current, target, nowMs, instant) {
  const to = clampPose(target);
  if (instant) return { pose: to, tween: null };
  return { pose: current, tween: { from: current, to, start: nowMs, duration: FLY_MS } };
}

export function stepFly(tween, nowMs) {
  if (!tween) return { pose: null, tween: null };
  const t = (nowMs - tween.start) / tween.duration;
  if (t >= 1) return { pose: tween.to, tween: null };
  return { pose: interpolatePose(tween.from, tween.to, t), tween };
}

// Lazily builds a camera rig bound to a canvas. Async because three.js and
// OrbitControls are imported on demand (keeps pure helpers testable in Node).
// opts: { domElement, host, reducedMotion: () => boolean, requestRender: () => void, aspect }
export async function createCameraRig(opts) {
  const THREE = await import("three");
  const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");

  const camera = new THREE.PerspectiveCamera(FOV, opts.aspect || 1, 0.1, 200);
  const controls = new OrbitControls(camera, opts.domElement);
  controls.enableDamping = false;
  controls.minDistance = BOUNDS.minDistance;
  controls.maxDistance = BOUNDS.maxDistance;
  controls.minPolarAngle = BOUNDS.minPolar;
  controls.maxPolarAngle = BOUNDS.maxPolar;
  controls.screenSpacePanning = false;

  const reduced = typeof opts.reducedMotion === "function" ? opts.reducedMotion : () => false;
  const requestRender = typeof opts.requestRender === "function" ? opts.requestRender : () => {};
  let tween = null;
  let applying = false;

  function readPose() {
    return positionToPose(camera.position, controls.target);
  }

  function writePose(p) {
    const c = clampPose(p);
    const pos = poseToPosition(c);
    applying = true;
    controls.target.set(c.tx, c.ty, c.tz);
    camera.position.set(pos.x, pos.y, pos.z);
    camera.lookAt(c.tx, c.ty, c.tz);
    controls.update();
    applying = false;
  }

  function onChange() {
    if (!applying) {
      // Clamp the target to the allowed circle after every OrbitControls change.
      const tg = clampTarget({ tx: controls.target.x, ty: controls.target.y, tz: controls.target.z });
      if (tg.tx !== controls.target.x || tg.tz !== controls.target.z || tg.ty !== controls.target.y) {
        const pose = readPose();
        pose.tx = tg.tx; pose.ty = tg.ty; pose.tz = tg.tz;
        writePose(pose);
      }
    }
    requestRender();
  }
  controls.addEventListener("change", onChange);
  // A user drag cancels a fly-to in flight.
  controls.addEventListener("start", () => { tween = null; });

  writePose(DEFAULT_POSE);

  function setPose(p, forceInstant) {
    const s = startFly(readPose(), p, 0, forceInstant === true || reduced());
    if (s.tween) {
      tween = s.tween;
      tween.start = -1; // set on first update tick
    } else {
      tween = null;
      writePose(s.pose);
    }
    requestRender();
  }

  return {
    camera,
    controls,
    getPose: readPose,
    flyToStation(anchor, instant) { setPose(framingPose(anchor), instant); },
    resetView(instant) { setPose(DEFAULT_POSE, instant); },
    // Keyboard handler; returns true when the key was consumed.
    handleKey(key, shiftKey) {
      const action = keyToCameraAction(key, shiftKey);
      if (!action) return false;
      tween = null;
      writePose(applyCameraAction(readPose(), action, DEFAULT_POSE));
      requestRender();
      return true;
    },
    setAspect(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      requestRender();
    },
    // Called from the loop's update(now). Returns true while a tween is in flight.
    update(nowMs) {
      if (!tween) return false;
      if (tween.start < 0) tween.start = nowMs;
      const r = stepFly(tween, nowMs);
      tween = r.tween;
      writePose(r.pose);
      return tween !== null;
    },
    animating() { return tween !== null; },
    dispose() {
      controls.removeEventListener("change", onChange);
      controls.dispose();
    },
  };
}
