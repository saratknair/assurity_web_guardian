// Agent_Figures: abstract board-game pawns driven by stateAt(tl, t).figures.
// A figure exists only while the snapshot lists its agent (an event backs it).
// No DOM access at import time.
import * as THREE from "three";
import {
  agentColour, assignSlots, anchorFor, bezierControl, quadBezier,
  moveDuration, shouldSnap, bobOffset, figureVisual, stackLines,
} from "./layout.js";

function buildPawn(colour, template) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 0.5, 12), mat);
  base.position.y = 0.25;
  group.add(base);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mat);
  head.position.y = 0.72;
  group.add(head);

  const bandMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.5 });
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 14), bandMat);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.45;
  group.add(band);

  // Glow ring at the base, shown only while the figure is working.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.78, 28),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  group.add(ring);
  group.userData.ring = ring;
  group.userData.mats = [mat, bandMat];
  group.userData.colour = colour;

  // Blob shadow (transparent circle, no shadow maps).
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  group.userData.blob = blob;

  return group;
}

// Static look for working (bright, emissive, ring) and idle (dimmed) figures.
// No animation: a paused scene stays still.
function applyLook(rec) {
  const mats = rec.group.userData.mats;
  const colour = rec.group.userData.colour;
  const vis = figureVisual({ highlighted: rec.highlighted, caption: rec.captionText });
  for (let i = 0; i < mats.length; i++) {
    const m = mats[i];
    if (vis.lit) {
      m.emissive.setHex(i === 0 ? colour : 0xffffff);
      m.emissiveIntensity = i === 0 ? 0.55 : 0.25;
      m.transparent = false;
      m.opacity = 1;
    } else {
      m.emissive.setHex(0x000000);
      m.emissiveIntensity = 0;
      m.transparent = true;
      m.opacity = 0.45;
    }
    m.needsUpdate = true;
  }
  rec.group.userData.ring.visible = vis.lit;
  rec.blob.material.opacity = vis.lit ? 0.35 : 0.15;
}

// createFigures(sceneApi, opts) -> { sync, tick, get, count, dispose }
// opts.reducedMotion: boolean or function returning boolean.
export function createFigures(sceneApi, opts) {
  const o = opts || {};
  const items = {}; // agent -> figure record
  const stationCount = sceneApi.stations.length;

  // True while playback is paused or scrubbed: working figures hold still so a
  // paused Diorama renders no new frames (requirement 16.6).
  let still = false;

  function isReduced() {
    return typeof o.reducedMotion === "function" ? !!o.reducedMotion() : !!o.reducedMotion;
  }

  function stationIdx(id) {
    return sceneApi.stationIndex(id);
  }

  function place(rec, p) {
    rec.pos = { x: p.x, y: 0, z: p.z };
    rec.group.position.set(p.x, rec.working && !still ? bobOffset(true, rec.clock) : 0, p.z);
    rec.blob.position.set(p.x, 0.02, p.z);
  }

  function create(f, target) {
    const group = buildPawn(agentColour(f.agent), !!f.template);
    const blob = group.userData.blob;
    sceneApi.scene.add(group);
    sceneApi.scene.add(blob);
    const captionText = typeof f.caption === "string" ? f.caption : "";
    group.traverse(function (obj) { if (obj.isMesh) obj.userData.agent = f.agent; });
    const rec = {
      agent: f.agent, template: !!f.template, station: f.station, working: !!f.working, highlighted: !!f.highlighted,
      group, blob, captionText, pos: { x: target.x, y: 0, z: target.z },
      move: null, clock: 0,
    };
    items[f.agent] = rec;
    place(rec, target);
    applyLook(rec);
    return rec;
  }

  function remove(agent) {
    const rec = items[agent];
    if (!rec) return;
    sceneApi.scene.remove(rec.group);
    sceneApi.scene.remove(rec.blob);
    rec.group.traverse(function (obj) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    rec.blob.geometry.dispose();
    rec.blob.material.dispose();
    delete items[agent];
  }

  // Apply a snapshot's figures list. scrubbed=true means the position was set
  // by scrubbing or jumping: snap everything, no intermediate animation.
  function sync(figures, syncOpts) {
    const list = Array.isArray(figures) ? figures : [];
    const scrubbed = !!(syncOpts && syncOpts.scrubbed);
    still = scrubbed;
    const reduced = isReduced();
    const slots = assignSlots(list);
    const wanted = {};
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const idx = stationIdx(f.station);
      if (idx < 0) continue; // unknown station: do not invent a place
      wanted[f.agent] = true;
      const target = anchorFor(idx, stationCount, slots[f.agent], !!f.highlighted);
      let rec = items[f.agent];
      if (!rec) {
        create(f, target);
        continue;
      }
      rec.working = !!f.working;
      rec.highlighted = !!f.highlighted;
      rec.captionText = typeof f.caption === "string" ? f.caption : "";
      applyLook(rec);
      const moved = rec.station !== f.station ||
        Math.abs(rec.pos.x - target.x) > 1e-6 || Math.abs(rec.pos.z - target.z) > 1e-6;
      rec.station = f.station;
      if (!moved) { if (!rec.move) place(rec, rec.pos); continue; }
      if (shouldSnap({ reducedMotion: reduced, scrubbed, hasPrevious: true })) {
        rec.move = null;
        place(rec, target);
      } else {
        const from = rec.pos;
        const dur = moveDuration(from, target);
        rec.move = { from: { x: from.x, y: 0, z: from.z }, to: target, ctrl: bezierControl(from, target), t: 0, dur };
        if (dur === 0) { rec.move = null; place(rec, target); }
      }
    }
    const names = Object.keys(items);
    for (let i = 0; i < names.length; i++) if (!wanted[names[i]]) remove(names[i]);
    updateStacks(list);
  }

  // One stacked activity block per Station for its lit figures; hidden when none.
  function updateStacks(list) {
    const groups = stackLines(list);
    const lit = {};
    for (let i = 0; i < groups.length; i++) {
      const idx = stationIdx(groups[i].station);
      if (idx < 0) continue;
      lit[idx] = true;
      sceneApi.stations[idx].stack.setLines(groups[i].lines.map(function (l) { return l.text; }));
    }
    for (let i = 0; i < stationCount; i++) if (!lit[i]) sceneApi.stations[i].stack.setLines([]);
  }

  // Advance animation by dt seconds. Returns true while anything is still
  // moving or bobbing (the loop should keep rendering).
  function tick(dt) {
    let active = false;
    const reduced = isReduced();
    const names = Object.keys(items);
    for (let i = 0; i < names.length; i++) {
      const rec = items[names[i]];
      rec.clock += dt;
      if (rec.move) {
        rec.move.t += dt;
        const u = rec.move.dur > 0 ? rec.move.t / rec.move.dur : 1;
        const p = quadBezier(rec.move.from, rec.move.ctrl, rec.move.to, u);
        place(rec, p);
        if (u >= 1) { place(rec, rec.move.to); rec.move = null; } else active = true;
      } else if (rec.working && !reduced && !still) {
        place(rec, rec.pos);
        active = true;
      } else if (rec.group.position.y !== 0) {
        rec.group.position.y = 0;
      }
    }
    return active;
  }

  function dispose() {
    const names = Object.keys(items);
    for (let i = 0; i < names.length; i++) remove(names[i]);
  }

  return {
    sync,
    tick,
    dispose,
    // Pawn meshes (userData.agent set) for hover picking.
    meshes: function () {
      const out = [];
      const names = Object.keys(items);
      for (let i = 0; i < names.length; i++) {
        items[names[i]].group.traverse(function (obj) { if (obj.isMesh && obj.visible) out.push(obj); });
      }
      return out;
    },
    get: function (agent) { return items[agent] || null; },
    count: function () { return Object.keys(items).length; },
  };
}
