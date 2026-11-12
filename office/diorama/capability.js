// Low-end detection and quality choice. Pure; no DOM access, no three.js.
// Requirement 16.7: low capability = device pixel ratio above 2, fewer than 4
// logical processors, or a failed frame-rate check. Shadows are always off.

export const FRAME_SAMPLE_COUNT = 20;
export const SLOW_FRAME_MS = 50;
export const MAX_PIXEL_RATIO = 2;

export function median(values) {
  const v = (Array.isArray(values) ? values : []).filter((n) => typeof n === "number" && Number.isFinite(n));
  if (v.length === 0) return null;
  v.sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// True when the first FRAME_SAMPLE_COUNT frame deltas have a median above 50 ms.
// Fewer than FRAME_SAMPLE_COUNT samples is "not enough data" and never fails.
export function frameRateFailed(deltas) {
  const list = Array.isArray(deltas) ? deltas.slice(0, FRAME_SAMPLE_COUNT) : [];
  if (list.length < FRAME_SAMPLE_COUNT) return false;
  const m = median(list);
  return m !== null && m > SLOW_FRAME_MS;
}

export function isLowEnd(input) {
  const i = input || {};
  const dpr = typeof i.devicePixelRatio === "number" && i.devicePixelRatio > 0 ? i.devicePixelRatio : 1;
  const hc = i.hardwareConcurrency;
  if (dpr > MAX_PIXEL_RATIO) return true;
  if (typeof hc === "number" && hc > 0 && hc < 4) return true;
  return frameRateFailed(i.frameDeltas);
}

// Returns { pixelRatio, shadows, lowEnd }.
export function chooseQuality(input) {
  const i = input || {};
  const dpr = typeof i.devicePixelRatio === "number" && i.devicePixelRatio > 0 ? i.devicePixelRatio : 1;
  const lowEnd = isLowEnd(i);
  const pixelRatio = lowEnd ? 1 : Math.min(dpr, MAX_PIXEL_RATIO);
  return { pixelRatio, shadows: false, lowEnd };
}

// Reads inputs from a window-like object lazily (only when called).
export function readDeviceInputs(win, nav) {
  const n = nav || (win && win.navigator) || {};
  return {
    devicePixelRatio: win && typeof win.devicePixelRatio === "number" ? win.devicePixelRatio : 1,
    hardwareConcurrency: n.hardwareConcurrency,
  };
}

// Collects the first frame deltas and reports once when the quality should drop.
export function createFrameMonitor(onLowEnd) {
  const deltas = [];
  let last = null;
  let done = false;
  return {
    sample(nowMs) {
      if (done) return;
      if (last !== null) {
        const d = nowMs - last;
        // Gaps over 1s are idle periods (render on demand), not slow frames.
        if (d >= 0 && d <= 1000) deltas.push(d);
      }
      last = nowMs;
      if (deltas.length >= FRAME_SAMPLE_COUNT) {
        done = true;
        if (frameRateFailed(deltas) && typeof onLowEnd === "function") onLowEnd(deltas.slice());
      }
    },
    breakChain() {
      last = null;
    },
  };
}
