// Pure geometry helpers for the Diorama. No three.js, no DOM: unit tested under Node.
// Coordinates are {x, y, z}; the ring lies on the x/z plane, y is up.

export const RING_RADIUS = 7;
export const ANCHOR_RADIUS = 5.0; // where figures stand (between desk and centre)
export const MOVE_SPEED = 14; // units per second
export const MOVE_MAX_SECONDS = 0.6;
export const BOB_AMPLITUDE = 0.08;
export const BOW_FACTOR = 0.45; // how far the Bezier control point is pulled to the centre

// Station colours (never the only cue: every Station also has a text label).
export const STATION_COLOURS = Object.freeze({
  "test-plan-desk": 0x6aa9ff,
  "browser-bay": 0x5ad1a0,
  "visual-check": 0xc792ea,
  "accessibility-check": 0xf2c14e,
  "review-desk": 0xff8a65,
  "records-room": 0x8fb8c9,
});

// Distinct colour per Guardian component.
export const AGENT_COLOURS = Object.freeze({
  Test_Generator: 0x6aa9ff,
  Observation_Runner: 0x5ad1a0,
  Comparator: 0xc792ea,
  Quality_Analysis_Agent: 0xf2c14e,
  Triage_Agent: 0xff8a65,
  Lifecycle_Tracker: 0x8fb8c9,
  Decision_Recorder: 0xe57399,
});
const FALLBACK_AGENT_COLOUR = 0xb0b8c4;

export function agentColour(agent) {
  return Object.prototype.hasOwnProperty.call(AGENT_COLOURS, agent)
    ? AGENT_COLOURS[agent] : FALLBACK_AGENT_COLOUR;
}

// Ring angle for station index i (process order, 60 degrees apart for six).
export function stationAngle(index, count) {
  const n = count && count > 0 ? count : 6;
  return (index * 2 * Math.PI) / n;
}

function polar(radius, angle) {
  return { x: radius * Math.sin(angle), y: 0, z: -radius * Math.cos(angle) };
}

// Centre of the bay (desk position) on the ring.
export function stationPosition(index, count) {
  return polar(RING_RADIUS, stationAngle(index, count));
}

// Where figures stand for a station, on the centre side of the desk.
// slot offsets several figures sideways so they do not overlap.
export function stationAnchor(index, count, slot) {
  const a = stationAngle(index, count);
  const base = polar(ANCHOR_RADIUS, a);
  const s = slot && slot > 0 ? slot : 0;
  if (s === 0) return base;
  // tangent direction at angle a is (cos a, sin a) in x/z
  const side = (s % 2 === 1 ? 1 : -1) * Math.ceil(s / 2) * 0.9;
  return { x: base.x + Math.cos(a) * side, y: 0, z: base.z + Math.sin(a) * side };
}

// Idle figures wait nearer the ring centre, further from the desk.
export const STAND_BACK_RADIUS = 2.9;

export function standBackAnchor(index, count, slot) {
  const a = stationAngle(index, count);
  const base = polar(STAND_BACK_RADIUS, a);
  const s = slot && slot > 0 ? slot : 0;
  if (s === 0) return base;
  const side = (s % 2 === 1 ? 1 : -1) * Math.ceil(s / 2) * 0.9;
  return { x: base.x + Math.cos(a) * side, y: 0, z: base.z + Math.sin(a) * side };
}

// Idle figures wait beside their home Station, on the ring (outer) side of the
// desk and offset sideways, so they are neither in the scene centre nor on the
// working spot. Slots spread further along the tangent so figures never overlap.
export const HOME_RADIUS = 8.4;
export const HOME_SIDE_OFFSET = 2.0;
export const HOME_SLOT_SPACING = 1.1;

export function homeAnchor(index, count, slot) {
  const a = stationAngle(index, count);
  const base = polar(HOME_RADIUS, a);
  const s = slot && slot > 0 ? slot : 0;
  const side = HOME_SIDE_OFFSET + s * HOME_SLOT_SPACING;
  return { x: base.x + Math.cos(a) * side, y: 0, z: base.z + Math.sin(a) * side };
}

// Highlighted figures stand at the desk anchor; idle ones wait at their home spot.
export function anchorFor(index, count, slot, highlighted) {
  return highlighted ? stationAnchor(index, count, slot) : homeAnchor(index, count, slot);
}

// Pure visual state of a figure: lit (emissive, glow ring), name label, caption.
// Driven by `highlighted` (working or held), not by `working`.
export function figureVisual(fig) {
  const f = fig || {};
  const lit = !!f.highlighted;
  const text = typeof f.caption === "string" ? f.caption : "";
  return { lit, showName: lit, caption: lit ? text : "" };
}

export function distance(a, b) {
  const dx = a.x - b.x, dy = (a.y || 0) - (b.y || 0), dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Quadratic Bezier control point: the midpoint pulled toward the ring centre
// so the path bows inward instead of cutting through desks.
export function bezierControl(from, to, bow) {
  const k = typeof bow === "number" ? bow : BOW_FACTOR;
  const mx = (from.x + to.x) / 2, mz = (from.z + to.z) / 2;
  return { x: mx * (1 - k), y: 0, z: mz * (1 - k) };
}

export function quadBezier(p0, p1, p2, u) {
  const t = u < 0 ? 0 : u > 1 ? 1 : u;
  const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x,
    y: a * (p0.y || 0) + b * (p1.y || 0) + c * (p2.y || 0),
    z: a * p0.z + b * p1.z + c * p2.z,
  };
}

// Sampled path points (inclusive of both ends) for tests and debugging.
export function bezierPath(from, to, steps) {
  const n = steps && steps > 1 ? Math.floor(steps) : 8;
  const ctrl = bezierControl(from, to);
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(quadBezier(from, ctrl, to, i / n));
  return pts;
}

// Constant speed, capped. Returns seconds.
export function moveDuration(from, to) {
  const d = distance(from, to);
  if (!(d > 0)) return 0;
  return Math.min(MOVE_MAX_SECONDS, d / MOVE_SPEED);
}

// Snap (no animation) when Reduced_Motion is on, when the position was set by
// scrubbing or jumping, or when the figure has no previous place to move from.
export function shouldSnap(opts) {
  const o = opts || {};
  return !!(o.reducedMotion || o.scrubbed || !o.hasPrevious);
}

// Vertical bob for a working figure. t in seconds.
export function bobOffset(working, t) {
  if (!working) return 0;
  return BOB_AMPLITUDE * Math.sin(t * 2 * Math.PI * 0.8);
}

// Label text for a figure: the component name only.
export function figureLabel(agent) {
  return String(agent);
}

// Fixed pixel height of one line in a stacked activity block.
export const STACK_LINE_PX = 18;
// World height at which the stacked block's bottom edge is anchored above a desk.
export const STACK_ANCHOR_Y = 2.9;
// Station name labels sit low on the front edge of their desk, toward the centre.
export const STATION_LABEL_RADIUS = 7.0;
export const STATION_LABEL_Y = 0.9;

// Vertical pixel offset of line i from the top of a stacked block.
export function stackOffset(i) {
  return (i > 0 ? Math.floor(i) : 0) * STACK_LINE_PX;
}

// Group lit figures by station: [{station, lines:[{agent, caption, text}]}].
// Stations sorted by id, lines by agent name, so the order is stable.
export function stackLines(figures) {
  const list = Array.isArray(figures) ? figures : [];
  const by = {};
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (!f || !f.highlighted) continue;
    const caption = typeof f.caption === "string" ? f.caption : "";
    if (!by[f.station]) by[f.station] = [];
    by[f.station].push({ agent: f.agent, caption, text: caption ? f.agent + " - " + caption : String(f.agent) });
  }
  return Object.keys(by).sort().map(function (st) {
    const lines = by[st].slice().sort(function (a, b) { return a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0; });
    return { station: st, lines };
  });
}

// Slot index for each agent at its station (sorted by agent name, stable).
// figures: [{agent, station}] -> { [agent]: slotIndex }
export function assignSlots(figures) {
  const byStation = {};
  const list = Array.isArray(figures) ? figures : [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (!byStation[f.station]) byStation[f.station] = [];
    byStation[f.station].push(f.agent);
  }
  const out = {};
  const ids = Object.keys(byStation);
  for (let i = 0; i < ids.length; i++) {
    const agents = byStation[ids[i]].slice().sort();
    for (let j = 0; j < agents.length; j++) out[agents[j]] = j;
  }
  return out;
}
