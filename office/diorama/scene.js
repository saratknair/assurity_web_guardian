// Diorama scene: six Station bays on a ring, procedural geometry, floor,
// lights, and an HTML label overlay (aria-hidden; the Stations list carries the
// same facts as text). No DOM access at import time.
import * as THREE from "three";
import { STATIONS } from "../lib/stations.js";
import { el } from "../lib/dom.js";
import {
  RING_RADIUS, STATION_COLOURS, stationAngle, stationPosition, stationAnchor,
} from "./layout.js";

const DEFAULT_BACKGROUND = 0x0f1419;

// createScene(labelHost, opts) -> scene API.
// labelHost: an element positioned over the canvas that receives label elements.
export function createScene(labelHost, opts) {
  const o = opts || {};
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(typeof o.background === "number" ? o.background : DEFAULT_BACKGROUND);

  // Lights (no shadow maps).
  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a3140, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(6, 12, 8);
  scene.add(sun);

  // Floor: disc plus grid.
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(11, 48),
    new THREE.MeshStandardMaterial({ color: 0x1b222c, roughness: 1, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(22, 22, 0x3a4658, 0x2a3342);
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

  // Project all labels to screen space. Call after camera changes or figure moves.
  function updateLabels(camera, width, height) {
    camera.updateMatrixWorld();
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      if (l.hidden) continue;
      tmp.copy(l.world).project(camera);
      if (tmp.z > 1 || tmp.z < -1) { l.node.style.display = "none"; continue; }
      const x = (tmp.x * 0.5 + 0.5) * width;
      const y = (-tmp.y * 0.5 + 0.5) * height;
      l.node.style.display = "block";
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

    pad.userData.stationId = st.id;
    desk.userData.stationId = st.id;
    top.userData.stationId = st.id;
    pickables.push(pad, desk, top, screen);
    scene.add(bay);

    const labelPos = { x: pos.x, y: 3.3, z: pos.z };
    const label = addLabel(st.name, labelPos, "diorama-label--station");

    stations.push({
      id: st.id,
      index: i,
      name: st.name,
      group: bay,
      pad,
      desk,
      screen,
      label,
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
    updateLabels,
    dispose,
  };
}
