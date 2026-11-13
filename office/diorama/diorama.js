// Diorama lazy entry: createDiorama(host, handlers). Wires capability, loop,
// camera, scene, figures and screens together. No DOM access at import time and
// no static three import here: the heavy modules are imported inside
// createDiorama so this file can be imported under Node for its pure helpers.
// Requirements 6.5, 8.6, 16.3, 16.4.
import { chooseQuality, readDeviceInputs, createFrameMonitor } from "./capability.js";
import { createLoop } from "./loop.js";

export const CONTEXT_RESTORE_MS = 3000;
export const CLICK_SLOP_PX = 5;
export const HOST_LABEL = "3D view of the Stations. Use the Stations list for the same information.";

// Pure: can a WebGL context be created? `createCanvas` returns a canvas-like
// object with getContext. Returns { ok, reason }.
export function detectWebGL(createCanvas) {
  try {
    const c = createCanvas();
    if (!c || typeof c.getContext !== "function") return { ok: false, reason: "no-canvas" };
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return { ok: false, reason: "no-webgl" };
    try {
      const ext = typeof gl.getExtension === "function" ? gl.getExtension("WEBGL_lose_context") : null;
      if (ext && typeof ext.loseContext === "function") ext.loseContext();
    } catch (e) { /* releasing the probe is best effort */ }
    return { ok: true, reason: "" };
  } catch (e) {
    return { ok: false, reason: "no-webgl" };
  }
}

// Pure: client coordinates to normalised device coordinates for a rect.
export function pointerToNdc(rect, clientX, clientY) {
  const w = rect && rect.width > 0 ? rect.width : 1;
  const h = rect && rect.height > 0 ? rect.height : 1;
  const left = rect ? rect.left : 0;
  const top = rect ? rect.top : 0;
  return { x: ((clientX - left) / w) * 2 - 1, y: -(((clientY - top) / h) * 2 - 1) };
}

// Pure: is pointerup close enough to pointerdown to count as a click (not an orbit drag)?
export function isClick(down, up, slop) {
  if (!down || !up) return false;
  const s = typeof slop === "number" ? slop : CLICK_SLOP_PX;
  const dx = up.x - down.x, dy = up.y - down.y;
  return dx * dx + dy * dy <= s * s;
}

// Pure: a cheap signature of the figures list so unchanged snapshots do not re-render.
export function figuresSignature(figures, scrubbed) {
  const list = Array.isArray(figures) ? figures : [];
  const parts = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i] || {};
    parts.push([f.agent, f.station, f.working ? 1 : 0, f.highlighted ? 1 : 0, f.template ? 1 : 0, f.highlighted && f.caption ? f.caption : ""].join("|"));
  }
  return (scrubbed ? "s:" : "p:") + parts.join(";");
}

export async function createDiorama(host, handlers) {
  const h = handlers || {};
  const reducedMotion = typeof h.reducedMotion === "function" ? h.reducedMotion : () => false;
  let fellBack = false;
  function fallback(reason) {
    if (fellBack) return;
    fellBack = true;
    try { if (typeof h.onFallback === "function") h.onFallback(reason); } catch (e) { /* handler errors must not escape */ }
  }

  const cleanups = [];
  function runCleanups() {
    while (cleanups.length) {
      const fn = cleanups.pop();
      try { fn(); } catch (e) { /* keep tearing down */ }
    }
  }

  try {
    if (!host || typeof document === "undefined") throw new Error("no host");
    const probe = detectWebGL(() => document.createElement("canvas"));
    if (!probe.ok) {
      fallback(probe.reason);
      return null;
    }

    const THREE = await import("three");
    const { createCameraRig } = await import("./camera.js");
    const { createScene } = await import("./scene.js");
    const { createFigures } = await import("./figures.js");
    const { createScreens } = await import("./screens.js");

    // DOM: canvas plus label overlay inside the host.
    host.setAttribute("tabindex", "0");
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", HOST_LABEL);
    host.setAttribute("aria-describedby", "diorama-help");
    if (!host.style.position) host.style.position = "relative";

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    const labelHost = document.createElement("div");
    host.appendChild(canvas);
    host.appendChild(labelHost);
    cleanups.push(() => {
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (labelHost.parentNode) labelHost.parentNode.removeChild(labelHost);
    });

    const quality = chooseQuality(readDeviceInputs(window, window.navigator));
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !quality.lowEnd, powerPreference: "default" });
    renderer.shadowMap.enabled = false;
    renderer.setPixelRatio(quality.pixelRatio);
    cleanups.push(() => renderer.dispose());

    function size() {
      return { w: Math.max(1, host.clientWidth || 1), h: Math.max(1, host.clientHeight || 1) };
    }
    let dims = size();
    renderer.setSize(dims.w, dims.h, false);

    let loop = null;
    function requestRender() { if (loop) loop.requestRender(); }

    const rig = await createCameraRig({
      domElement: canvas,
      host,
      reducedMotion,
      requestRender,
      aspect: dims.w / dims.h,
    });
    cleanups.push(() => rig.dispose());

    const sceneApi = createScene(labelHost, {});
    cleanups.push(() => sceneApi.dispose());

    const figures = createFigures(sceneApi, { reducedMotion });
    cleanups.push(() => figures.dispose());

    let screens = null;
    function makeScreens(runId, hasImages) {
      if (screens) screens.dispose();
      screens = createScreens(sceneApi, { runId, hasImages: !!hasImages, onChange: requestRender });
    }
    makeScreens(undefined, false);
    cleanups.push(() => { if (screens) screens.dispose(); screens = null; });

    // Loop.
    const monitor = createFrameMonitor(() => {
      renderer.setPixelRatio(1);
      renderer.setSize(dims.w, dims.h, false);
      requestRender();
    });
    let figuresActive = false;
    let lastNow = null;
    loop = createLoop({
      host,
      update(now) {
        const dt = lastNow === null ? 0 : Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
        lastNow = now;
        rig.update(now);
        figuresActive = figures.tick(dt);
      },
      render() {
        sceneApi.updateLabels(rig.camera, dims.w, dims.h);
        renderer.render(sceneApi.scene, rig.camera);
      },
      animating: () => rig.animating() || figuresActive,
      onFrame(now) {
        monitor.sample(now);
        if (!rig.animating() && !figuresActive) { monitor.breakChain(); lastNow = null; }
      },
    });
    cleanups.push(() => loop.dispose());

    // Resize.
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        dims = size();
        rig.setAspect(dims.w / dims.h);
        renderer.setSize(dims.w, dims.h, false);
        requestRender();
      });
      ro.observe(host);
      cleanups.push(() => ro.disconnect());
    }

    // Station selection by raycast (a drag orbits and is not a click).
    const raycaster = new THREE.Raycaster();
    let down = null;
    function onPointerDown(ev) { down = { x: ev.clientX, y: ev.clientY }; }
    function onPointerUp(ev) {
      const start = down;
      down = null;
      if (ev.button !== undefined && ev.button !== 0) return;
      if (!isClick(start, { x: ev.clientX, y: ev.clientY })) return;
      const ndc = pointerToNdc(canvas.getBoundingClientRect(), ev.clientX, ev.clientY);
      raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), rig.camera);
      const hits = raycaster.intersectObjects(sceneApi.pickables, false);
      for (let i = 0; i < hits.length; i++) {
        const id = hits[i].object && hits[i].object.userData && hits[i].object.userData.stationId;
        if (id) {
          if (typeof h.onSelectStation === "function") h.onSelectStation(id);
          return;
        }
      }
    }
    // Hover: the native tooltip (title) names the figure under the pointer, so an
    // idle figure's name stays available without a visible label. No rendering.
    function onPointerMove(ev) {
      if (ev.buttons) return;
      const ndc = pointerToNdc(canvas.getBoundingClientRect(), ev.clientX, ev.clientY);
      raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), rig.camera);
      const hits = raycaster.intersectObjects(figures.meshes(), false);
      const name = hits.length && hits[0].object.userData ? hits[0].object.userData.agent : "";
      const next = name || "";
      if (canvas.title !== next) canvas.title = next;
    }
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointermove", onPointerMove);
    cleanups.push(() => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointermove", onPointerMove);
    });

    // Context loss: stop drawing; fall back unless it restores within 3 s.
    let lostTimer = null;
    let disposed = false;
    function onLost(ev) {
      ev.preventDefault();
      loop.setVisible(false);
      if (lostTimer === null) {
        lostTimer = setTimeout(() => {
          lostTimer = null;
          if (disposed) return;
          fallback("context-lost");
          api.dispose();
        }, CONTEXT_RESTORE_MS);
      }
    }
    function onRestored() {
      if (lostTimer !== null) { clearTimeout(lostTimer); lostTimer = null; }
      if (fellBack || disposed) return;
      loop.setVisible(true);
      requestRender();
    }
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    cleanups.push(() => {
      if (lostTimer !== null) { clearTimeout(lostTimer); lostTimer = null; }
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    });

    function onPageHide() { api.dispose(); }
    window.addEventListener("pagehide", onPageHide);
    cleanups.push(() => window.removeEventListener("pagehide", onPageHide));

    let lastSig = null;
    let current = { runId: undefined, hasImages: false };

    const api = {
      update(input) {
        if (disposed) return;
        const i = input || {};
        const snap = i.snapshot || {};
        const sig = figuresSignature(snap.figures, !!i.scrubbed);
        let changed = false;
        if (sig !== lastSig || i.scrubbed) {
          figures.sync(snap.figures, { scrubbed: !!i.scrubbed });
          lastSig = sig;
          changed = true;
        }
        if (i.runId !== undefined && (i.runId !== current.runId || !!i.hasImages !== current.hasImages)) {
          current = { runId: i.runId, hasImages: !!i.hasImages };
          makeScreens(current.runId, current.hasImages);
          changed = true;
        }
        if (screens && screens.update(snap.screens)) changed = true;
        if (changed) requestRender();
      },
      focusStation(stationId) {
        if (disposed) return;
        const idx = sceneApi.stationIndex(stationId);
        if (idx < 0) return;
        rig.flyToStation(sceneApi.stations[idx].anchor, reducedMotion());
      },
      resetView() {
        if (disposed) return;
        rig.resetView(reducedMotion());
      },
      handleKey(event) {
        if (disposed || !event) return false;
        const used = rig.handleKey(event.key, event.shiftKey);
        if (used && typeof event.preventDefault === "function") event.preventDefault();
        return used;
      },
      setRun(run) {
        if (disposed) return;
        const r = run || {};
        current = { runId: r.runId, hasImages: !!r.hasImages };
        makeScreens(current.runId, current.hasImages);
        lastSig = null;
        requestRender();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        runCleanups();
      },
    };

    requestRender();
    return api;
  } catch (err) {
    runCleanups();
    fallback("setup-failed");
    return null;
  }
}
