import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import * as C from "../../office/diorama/capability.js";
// @ts-expect-error plain browser ES module without type declarations
import * as L from "../../office/diorama/loop.js";
// @ts-expect-error plain browser ES module without type declarations
import * as K from "../../office/diorama/camera.js";

describe("capability", () => {
  it("caps pixel ratio at 2 and keeps shadows off", () => {
    expect(C.chooseQuality({ devicePixelRatio: 2, hardwareConcurrency: 8 })).toEqual({ pixelRatio: 2, shadows: false, lowEnd: false });
    expect(C.chooseQuality({ devicePixelRatio: 1.5, hardwareConcurrency: 8 }).pixelRatio).toBe(1.5);
  });
  it("drops to ratio 1 for dpr > 2, few cores, or slow frames", () => {
    expect(C.chooseQuality({ devicePixelRatio: 3, hardwareConcurrency: 8 }).pixelRatio).toBe(1);
    expect(C.chooseQuality({ devicePixelRatio: 2, hardwareConcurrency: 2 }).lowEnd).toBe(true);
    const slow = Array.from({ length: 20 }, () => 60);
    expect(C.chooseQuality({ devicePixelRatio: 2, hardwareConcurrency: 8, frameDeltas: slow }).pixelRatio).toBe(1);
    expect(C.isLowEnd({ devicePixelRatio: 1, hardwareConcurrency: 8, frameDeltas: [60, 60] })).toBe(false);
  });
  it("frame monitor reports slow frames once", () => {
    let calls = 0;
    const m = C.createFrameMonitor(() => { calls += 1; });
    for (let i = 0; i < 40; i++) m.sample(i * 60);
    expect(calls).toBe(1);
  });
});

describe("loop", () => {
  it("canSchedule honours visibility and scheduled state", () => {
    expect(L.canSchedule({ scheduled: false, visible: true, hidden: false })).toBe(true);
    expect(L.canSchedule({ scheduled: true, visible: true, hidden: false })).toBe(false);
    expect(L.canSchedule({ scheduled: false, visible: false, hidden: false })).toBe(false);
    expect(L.canSchedule({ scheduled: false, visible: true, hidden: true })).toBe(false);
  });
  it("renders on demand, counts frames, and idles", () => {
    const queue: Array<(n: number) => void> = [];
    const host = { dataset: {} as Record<string, string> };
    let renders = 0;
    const loop = L.createLoop({
      host, document: { hidden: false }, IntersectionObserver: null,
      requestAnimationFrame: (fn: (n: number) => void) => { queue.push(fn); return queue.length; },
      render: () => { renders += 1; },
    });
    expect(host.dataset.frameCount).toBe("0");
    loop.requestRender();
    loop.requestRender();
    expect(queue.length).toBe(1);
    queue.shift()!(0);
    expect(renders).toBe(1);
    expect(host.dataset.frameCount).toBe("1");
    expect(queue.length).toBe(0);
    loop.setVisible(false);
    loop.requestRender();
    expect(queue.length).toBe(0);
    loop.setVisible(true);
    expect(queue.length).toBe(1);
  });
});

describe("camera math", () => {
  it("clamps distance, polar and target radius", () => {
    const p = K.clampPose({ tx: 20, ty: 5, tz: 0, distance: 99, azimuth: 0, polar: 3 });
    expect(p.distance).toBe(30);
    expect(p.polar).toBe(1.35);
    expect(Math.hypot(p.tx, p.tz)).toBeCloseTo(8, 6);
    expect(K.clampPose({ ...K.DEFAULT_POSE, distance: 1, polar: 0 })).toMatchObject({ distance: 6, polar: 0.3 });
  });
  it("keyboard setters stay within bounds", () => {
    let p = K.DEFAULT_POSE;
    for (let i = 0; i < 100; i++) p = K.applyCameraAction(p, K.keyToCameraAction("ArrowUp", false), p);
    expect(p.polar).toBe(0.3);
    for (let i = 0; i < 100; i++) p = K.applyCameraAction(p, K.keyToCameraAction("-", false), p);
    expect(p.distance).toBe(30);
    for (let i = 0; i < 100; i++) p = K.applyCameraAction(p, K.keyToCameraAction("ArrowRight", true), p);
    expect(Math.hypot(p.tx, p.tz)).toBeLessThanOrEqual(8 + 1e-9);
    expect(K.applyCameraAction(p, K.keyToCameraAction("0", false), K.DEFAULT_POSE)).toMatchObject({ distance: 20, polar: 1 });
    expect(K.keyToCameraAction("x", false)).toBeNull();
  });
  it("pose and position round trip", () => {
    const pos = K.poseToPosition(K.DEFAULT_POSE);
    const back = K.positionToPose(pos, { x: 0, y: 0, z: 0 });
    expect(back.distance).toBeCloseTo(20, 6);
    expect(back.polar).toBeCloseTo(1, 6);
    expect(back.azimuth).toBeCloseTo(0.6, 6);
  });
  it("fly-to interpolates with easing and snaps when instant", () => {
    const to = K.framingPose({ x: 7, z: 0 });
    const inst = K.startFly(K.DEFAULT_POSE, to, 0, true);
    expect(inst.tween).toBeNull();
    expect(inst.pose).toEqual(to);
    const s = K.startFly(K.DEFAULT_POSE, to, 100, false);
    expect(s.tween).not.toBeNull();
    expect(K.stepFly(s.tween, 100).pose).toMatchObject({ distance: 20 });
    const mid = K.stepFly(s.tween, 400);
    expect(mid.tween).not.toBeNull();
    const end = K.stepFly(s.tween, 100 + K.FLY_MS);
    expect(end.tween).toBeNull();
    expect(end.pose).toEqual(to);
    expect(K.easeInOut(0.5)).toBeCloseTo(0.5, 9);
  });
  it("interpolates azimuth by the shortest arc", () => {
    const a = { ...K.DEFAULT_POSE, azimuth: 3 };
    const b = { ...K.DEFAULT_POSE, azimuth: -3 };
    const m = K.interpolatePose(a, b, 0.5);
    expect(Math.abs(Math.cos(m.azimuth) + 1)).toBeLessThan(0.01);
  });
});
