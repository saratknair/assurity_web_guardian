// Diorama scene: six Station bays on a ring, procedural geometry, floor,
// lights, and an HTML label overlay (aria-hidden; the Stations list carries the
// same facts as text). No DOM access at import time.
import * as THREE from "three";
import { STATIONS } from "../lib/stations.js";
import { el } from "../lib/dom.js";
import {
  RING_RADIUS, STATION_COLOURS, stationAngle, stationPosition, stationAnchor,
  STACK_ANCHOR_Y, STACK_LINE_PX, STATION_LABEL_RADIUS, STATION_LABEL_Y, stackOffset,
} from "./layout.js";

const DEFAULT_BACKGROUND = 0x2a3340;

// createScene(labelHost, opts) -> scene API.
// labelHost: an element positioned over the canvas that receives label elements.
export function createScene(labelHost, opts) {
  const o = opts || {};
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(typeof o.background === "number" ? o.background : DEFAULT_BACKGROUND);

  // Lights (no shadow maps).
  // Intensities are for three.js physically correct lighting (r155+).
  scene.add(new THREE.HemisphereLight(0xeef3ff, 0x6a7384, 2.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(6, 12, 8);
  scene.add(sun);

  // Floor: mid-light neutral grey disc plus grid.
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(11, 48),
    new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 1, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(22, 22, 0x5d6573, 0x7a828e);
  grid.position.y = 0.01;
  scene.add(grid);

  if (labelHost) {
    labelHost.setAttribute("aria-hidden", "true");
    labelHost.style.position = "absolute";
    labelHost.style.left = "0";
    labelHost.style.top = "0";
    labelHost.style.width = "100%";
    labelHost.style.height = "100%";
    labelHost.style.overflow = "hidden";
    labelHost.style.pointerEvents = "none";
  }

  const labels = [];
  const tmp = new THREE.Vector3();

  // Label: text-only element projected from a world position each frame.
  function addLabel(textValue, world, cls) {
    const node = el("div", { class: "diorama-label " + (cls || ""), text: textValue, "aria-hidden": "true" });
    node.style.position = "absolute";
    node.style.left = "0";
    node.style.top = "0";
    node.style.whiteSpace = "nowrap";
    node.style.display = "none";
    if (labelHost) labelHost.appendChild(node);
    const entry = { node, world: new THREE.Vector3(world.x, world.y, world.z), text: textValue };
    labels.push(entry);
    return {
      setText(s) { if (entry.text !== s) { entry.text = s; node.textContent = s; } },
      setPosition(p) { entry.world.set(p.x, p.y, p.z); },
      setVisible(v) { entry.hidden = !v; if (!v) node.style.display = "none"; },
      remove() {
        const i = labels.indexOf(entry);
        if (i !== -1) labels.splice(i, 1);
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }

  // Stack: one overlay element holding fixed-height child lines (text only).
  function addStack(world) {
    const node = el("div", { class: "diorama-stack", "aria-hidden": "true" });
    node.style.position = "absolute";
    node.style.left = "0";
    node.style.top = "0";
    node.style.whiteSpace = "nowrap";
    node.style.display = "none";
    if (labelHost) labelHost.appendChild(node);
    const entry = { node, world: new THREE.Vector3(world.x, world.y, world.z), text: "", hidden: true };
    labels.push(entry);
    return {
      // lines: array of strings; hidden when empty.
      setLines(lines) {
        const key = lines.join("\n");
        if (entry.text !== key) {
          entry.text = key;
          while (node.firstChild) node.removeChild(node.firstChild);
          for (let i = 0; i < lines.length; i++) {
            const line = el("div", { class: "diorama-label diorama-label--caption diorama-stack__line", text: lines[i] });
            line.style.display = "block";
            line.style.height = STACK_LINE_PX + "px";
            line.style.lineHeight = STACK_LINE_PX + "px";
            line.style.padding = "0 6px";
            line.style.boxSizing = "border-box";
            node.appendChild(line);
          }
          node.style.height = stackOffset(lines.length) + "px";
        }
        entry.hidden = lines.length === 0;
        if (entry.hidden) node.style.display = "none";
      },
      remove() {
        const i = labels.indexOf(entry);
        if (i !== -1) labels.splice(i, 1);
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }

  // Project all labels to screen space. Call after camera changes or figure moves.
  function updateLabels(camera, width, height) {
    camera.updateMatrixWorld();
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      if (l.hidden) continue;
      tmp.copy(l.world).project(camera);
      if (tmp.z > 1 || tmp.z < -1) { l.node.style.display = "none"; continue; }
      let x = (tmp.x * 0.5 + 0.5) * width;
      let y = (-tmp.y * 0.5 + 0.5) * height;
      l.node.style.display = "block";
      // Keep the label inside the host (node is centred horizontally, bottom-anchored).
      const w = l.node.offsetWidth || 0, h = l.node.offsetHeight || 0;
      if (w > 0 && width > w) x = Math.min(Math.max(x, w / 2 + 2), width - w / 2 - 2);
      if (h > 0 && height > h) y = Math.min(Math.max(y, h + 2), height - 2);
      l.node.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) translate(-50%,-100%)";
    }
  }

  // Station bays.
  const stations = [];
  const pickables = []; // meshes a Raycaster should test; userData.stationId is set
  const count = STATIONS.length;
  for (let i = 0; i < count; i++) {
    const st = STATIONS[i];
    const colour = STATION_COLOURS[st.id];
    const angle = stationAngle(i, count);
    const pos = stationPosition(i, count);
    const bay = new THREE.Group();
    bay.position.set(pos.x, 0, pos.z);
    bay.rotation.y = -angle; // local +z then points at the ring centre
    bay.userData.stationId = st.id;

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.0, 2.0, 0.08, 32),
      new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 })
    );
    pad.position.y = 0.04;
    bay.add(pad);

    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.9, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x2f3a4a, roughness: 0.8 })
    );
    desk.position.set(0, 0.5, -0.9);
    bay.add(desk);

    const top = new THREE.Mesh(
      new THREE.BoxGeometry(2.7, 0.08, 1.0),
      new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6 })
    );
    top.position.set(0, 0.99, -0.9);
    bay.add(top);

    // Screen on a stand, tilted back 15 degrees, facing the ring centre.
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 0.7, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1f27 })
    );
    stand.position.set(0, 1.4, -1.0);
    bay.add(stand);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.2),
      new THREE.MeshBasicMaterial({ color: 0x10151c, side: THREE.FrontSide })
    );
    screen.position.set(0, 2.35, -1.0);
    screen.rotation.x = -15 * Math.PI / 180;
    screen.userData.stationId = st.id;
    bay.add(screen);
    // Glow edge: a slightly larger bright plane just behind the screen, shown
    // while the Station has a working figure (static; no animation).
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.7, 1.5),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, side: THREE.FrontSide })
    );
    glow.position.copy(screen.position);
    glow.rotation.x = screen.rotation.x;
    glow.translateZ(-0.01);
    glow.visible = false;
    bay.add(glow);
    // Plain back panel: the screen is one-sided, so text is never seen mirrored from behind.
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x1a1f27, roughness: 0.9 })
    );
    back.position.copy(screen.position);
    back.rotation.set(screen.rotation.x, Math.PI, 0);
    back.userData.stationId = st.id;
    bay.add(back);
    pickables.push(back);

    // Desk lamp: small emissive bulb plus one shadowless PointLight per bay.
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff1c9 })
    );
    bulb.position.set(0, 1.9, 0.2);
    bay.add(bulb);
    const lamp = new THREE.PointLight(0xfff1d6, 14, 7, 2);
    lamp.position.copy(bulb.position);
    lamp.castShadow = false;
    bay.add(lamp);

    pad.userData.stationId = st.id;
    desk.userData.stationId = st.id;
    top.userData.stationId = st.id;
    pickables.push(pad, desk, top, screen);
    scene.add(bay);

    const front = { x: STATION_LABEL_RADIUS * Math.sin(angle), y: STATION_LABEL_Y, z: -STATION_LABEL_RADIUS * Math.cos(angle) };
    const label = addLabel(st.name, front, "diorama-label--station");
    const stack = addStack({ x: pos.x, y: STACK_ANCHOR_Y, z: pos.z });

    stations.push({
      id: st.id,
      index: i,
      name: st.name,
      group: bay,
      pad,
      desk,
      screen,
      glow,
      label,
      stack,
      position: pos,
      anchor: stationAnchor(i, count, 0),
    });
  }

  function stationIndex(id) {
    for (let i = 0; i < stations.length; i++) if (stations[i].id === id) return i;
    return -1;
  }

  function dispose() {
    for (let i = labels.length - 1; i >= 0; i--) {
      if (labels[i].node.parentNode) labels[i].node.parentNode.removeChild(labels[i].node);
    }
    labels.length = 0;
    scene.traverse(function (obj) {
      // Lamps (PointLight) hold no GPU resources without shadows; bulbs are disposed below.
      if (obj.isPointLight && obj.shadow && obj.shadow.dispose) obj.shadow.dispose();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(function (m) { m.dispose(); });
        else obj.material.dispose();
      }
    });
  }

  return {
    THREE,
    scene,
    stations,
    pickables,
    ringRadius: RING_RADIUS,
    stationIndex,
    addLabel,
    addStack,
    updateLabels,
    dispose,
  };
}
