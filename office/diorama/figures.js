// Agent_Figures: abstract board-game pawns driven by stateAt(tl, t).figures.
// A figure exists only while the snapshot lists its agent (an event backs it).
// No DOM access at import time.
import * as THREE from "three";
import {
  agentColour, assignSlots, stationAnchor, bezierControl, quadBezier,
  moveDuration, shouldSnap, bobOffset, figureLabel,
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

  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.05, 6, 14),
    new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.5 })
  );
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.45;
  group.add(band);

  // Blob shadow (transparent circle, no shadow maps).
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  group.userData.blob = blob;

  if (template) {
    // Flat paper sheet above the head marks an Automated_Template_Steps figure.
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.52),
      new THREE.MeshBasicMaterial({ color: 0xfaf6e8, side: THREE.DoubleSide })
    );
    sheet.position.y = 1.2;
    sheet.rotation.y = 0.5;
    sheet.userData.isTemplateMarker = true;
    group.add(sheet);
  }
  return group;
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
    rec.label.setPosition({ x: p.x, y: 1.5 + (rec.template ? 0.5 : 0), z: p.z });
  }

  function create(f, target) {
    const group = buildPawn(agentColour(f.agent), !!f.template);
    const blob = group.userData.blob;
    sceneApi.scene.add(group);
    sceneApi.scene.add(blob);
    const label = sceneApi.addLabel(figureLabel(f.agent, f.template), { x: 0, y: 1.5, z: 0 }, "diorama-label--figure");
    const rec = {
      agent: f.agent, template: !!f.template, station: f.station, working: !!f.working,
      group, blob, label, pos: { x: target.x, y: 0, z: target.z },
      move: null, clock: 0,
    };
    items[f.agent] = rec;
    place(rec, target);
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
    rec.label.remove();
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
      const target = stationAnchor(idx, stationCount, slots[f.agent]);
      let rec = items[f.agent];
      if (!rec) {
        create(f, target);
        continue;
      }
      rec.working = !!f.working;
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
    get: function (agent) { return items[agent] || null; },
    count: function () { return Object.keys(items).length; },
  };
}
