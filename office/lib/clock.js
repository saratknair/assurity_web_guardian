// Playback clock: a pure reducer. No DOM, no Date.now; callers pass elapsed real ms.
// State: { t, playing, speed, durationMs }. Every function returns a new state.

export const SPEEDS = Object.freeze([1, 2, 5, 10]);
// One frame advances at most this much real time, so a returning hidden tab
// does not jump (deliberate time-dilation guard).
export const MAX_FRAME_MS = 100;

function cleanDuration(d) {
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : 0;
}

function clampPos(t, durationMs) {
  const n = typeof t === "number" && Number.isFinite(t) ? t : 0;
  if (n < 0) return 0;
  return n > durationMs ? durationMs : n;
}

export function createClockState(durationMs) {
  return { t: 0, playing: false, speed: 1, durationMs: cleanDuration(durationMs) };
}

/** Advance by realDeltaMs of wall time. Pauses at the end and never loops. */
export function advance(state, realDeltaMs) {
  if (!state.playing) return state;
  const raw = typeof realDeltaMs === "number" && Number.isFinite(realDeltaMs) ? realDeltaMs : 0;
  const delta = Math.min(Math.max(raw, 0), MAX_FRAME_MS);
  const t = state.t + delta * state.speed;
  if (t >= state.durationMs) {
    return { ...state, t: state.durationMs, playing: false };
  }
  return { ...state, t };
}

export function seek(state, t) {
  return { ...state, t: clampPos(t, state.durationMs) };
}

/** Play from the current position; at the end there is nothing to play. */
export function play(state) {
  if (state.durationMs <= 0 || state.t >= state.durationMs) return { ...state, playing: false };
  return { ...state, playing: true };
}

export function pause(state) {
  return { ...state, playing: false };
}

/** Unsupported speeds leave the state unchanged. */
export function setSpeed(state, s) {
  return SPEEDS.indexOf(s) === -1 ? state : { ...state, speed: s };
}
