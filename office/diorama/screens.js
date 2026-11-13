// Station screens: canvas textures redrawn only when the screen signature changes.
// Pure helpers (no three, no DOM) are exported for tests; canvas use is runtime only.

import { imageUrl } from "../lib/data.js";

export const SCREEN_W = 512;
export const SCREEN_H = 256;
const PAD = 12;
const LINE_H = 24;
const FONT_PX = 17;
const AVG_CHAR_PX = 9; // rough monospace advance at FONT_PX
const THUMB_W = 176;
const THUMB_H = 88;

// Greatest number of characters that fit across the given pixel width.
export function charsThatFit(widthPx) {
  return Math.max(4, Math.floor(widthPx / AVG_CHAR_PX));
}

// Truncate one line to max chars, ending with "..." when cut.
export function truncateLine(text, max) {
  const s = String(text == null ? "" : text);
  if (s.length <= max) return s;
  if (max <= 3) return s.slice(0, Math.max(0, max));
  return s.slice(0, max - 3) + "...";
}

// Wrap text on spaces into lines of at most max chars; long words are hard-cut.
export function wrapLine(text, max) {
  const s = String(text == null ? "" : text);
  if (s.length <= max) return [s];
  const out = [];
  let cur = "";
  const words = s.split(" ");
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    while (w.length > max) {
      if (cur) { out.push(cur); cur = ""; }
      out.push(w.slice(0, max));
      w = w.slice(max);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= max) cur += " " + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

// Wrap every line, then cap to maxLines; the last visible line is truncated with "..." if cut.
export function fitLines(lines, maxChars, maxLines) {
  const wrapped = [];
  const src = Array.isArray(lines) ? lines : [];
  for (let i = 0; i < src.length; i++) {
    Array.prototype.push.apply(wrapped, wrapLine(src[i], maxChars));
  }
  if (wrapped.length <= maxLines) return wrapped;
  const out = wrapped.slice(0, maxLines);
  out[maxLines - 1] = truncateLine(out[maxLines - 1] + "...", maxChars);
  if (!/\.\.\.$/.test(out[maxLines - 1])) out[maxLines - 1] = truncateLine(out[maxLines - 1], maxChars - 3) + "...";
  return out;
}

// A Station glows while its latest entry is still in progress.
export function isStationWorking(screen) {
  if (!screen) return false;
  if (typeof screen.highlighted === "boolean") return screen.highlighted;
  return screen.done === false;
}

// Which lines a station shows. Records room shows the Step_Name only.
export function linesForStation(stationId, screen) {
  if (!screen || !Array.isArray(screen.lines)) return [];
  if (stationId === "records-room") {
    const step = screen.lines.filter(function (l) { return /^Step: /.test(l); });
    if (step.length) return [step[0]];
    return screen.step ? ["Step: " + screen.step] : screen.lines.slice(0, 1);
  }
  return screen.lines.slice();
}

// Whether the screen should try to show a screenshot thumbnail.
export function wantsThumbnail(stationId, screen, hasImages) {
  return Boolean(
    hasImages && stationId === "browser-bay" && screen && screen.evidenceRef &&
    screen.evidenceRef.slug && screen.evidenceRef.viewport
  );
}

// Signature of everything that affects the drawing. Equal signature => no redraw.
export function screenSignature(stationId, screen, thumbState) {
  if (!screen) return "empty";
  const ref = screen.evidenceRef;
  return [
    stationId,
    screen.entryId == null ? "" : String(screen.entryId),
    screen.done ? "1" : "0",
    thumbState || "none",
    ref ? ref.slug + "|" + ref.viewport : "",
    linesForStation(stationId, screen).join("\n"),
  ].join("\u0001");
}

function drawScreen(ctx, stationId, screen, thumb) {
  ctx.fillStyle = "#10151c";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.textBaseline = "top";
  ctx.font = FONT_PX + "px monospace";
  if (!screen) {
    ctx.fillStyle = "#8896a6";
    ctx.fillText("Idle", PAD, PAD);
    return;
  }
  const hasThumb = Boolean(thumb);
  const textW = SCREEN_W - 2 * PAD - (hasThumb ? THUMB_W + PAD : 0);
  const maxLines = Math.floor((SCREEN_H - 2 * PAD) / LINE_H);
  const lines = fitLines(linesForStation(stationId, screen), charsThatFit(textW), maxLines);
  for (let i = 0; i < lines.length; i++) {
    ctx.fillStyle = i === 0 ? "#e6edf5" : "#b8c4d2";
    ctx.fillText(lines[i], PAD, PAD + i * LINE_H);
  }
  if (hasThumb) {
    const x = SCREEN_W - PAD - THUMB_W;
    ctx.drawImage(thumb, x, PAD, THUMB_W, THUMB_H);
    ctx.strokeStyle = "#4a5a6c";
    ctx.strokeRect(x + 0.5, PAD + 0.5, THUMB_W - 1, THUMB_H - 1);
  }
  ctx.fillStyle = screen.done ? "#5ad18f" : "#e0b84a";
  ctx.fillRect(0, SCREEN_H - 6, SCREEN_W, 6);
}

// Create screens for a scene API (from createScene). opts: { runId, hasImages, base, onChange }.
// onChange() is called after an async thumbnail finishes so the caller can render on demand.
export function createScreens(sceneApi, opts) {
  const o = opts || {};
  const THREE = sceneApi.THREE;
  const items = new Map();
  const images = new Map(); // url -> { img, state: "loading"|"ready"|"failed" }
  let disposed = false;

  for (let i = 0; i < sceneApi.stations.length; i++) {
    const st = sceneApi.stations[i];
    const canvas = document.createElement("canvas");
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    const texture = new THREE.CanvasTexture(canvas);
    if ("SRGBColorSpace" in THREE) texture.colorSpace = THREE.SRGBColorSpace;
    st.screen.material.map = texture;
    st.screen.material.color.setHex(0xffffff);
    st.screen.material.needsUpdate = true;
    items.set(st.id, { st, canvas, ctx: canvas.getContext("2d"), texture, sig: null, screen: null });
  }

  function thumbFor(stationId, screen) {
    if (!wantsThumbnail(stationId, screen, o.hasImages)) return { state: "none", img: null };
    const ref = screen.evidenceRef;
    let url;
    try {
      url = imageUrl(o.runId, ref.slug, ref.viewport, o.base);
    } catch (e) {
      return { state: "failed", img: null };
    }
    let rec = images.get(url);
    if (!rec) {
      rec = { img: new Image(), state: "loading" };
      images.set(url, rec);
      rec.img.onload = function () {
        rec.state = "ready";
        if (!disposed) {
          refresh();
          if (typeof o.onChange === "function") o.onChange();
        }
      };
      rec.img.onerror = function () { rec.state = "failed"; if (!disposed) refresh(); };
      rec.img.src = url;
    }
    return { state: rec.state, img: rec.state === "ready" ? rec.img : null };
  }

  function refresh() {
    let changed = false;
    items.forEach(function (it, id) {
      const th = thumbFor(id, it.screen);
      const sig = screenSignature(id, it.screen, th.state);
      if (sig === it.sig) return;
      it.sig = sig;
      drawScreen(it.ctx, id, it.screen, th.img);
      it.texture.needsUpdate = true;
      changed = true;
    });
    return changed;
  }

  // screens: stateAt(tl, t).screens. Returns true when any texture was redrawn.
  function update(screens) {
    const src = screens || {};
    let glowChanged = false;
    items.forEach(function (it, id) {
      it.screen = src[id] || null;
      const on = isStationWorking(it.screen);
      if (it.st.glow && it.st.glow.visible !== on) { it.st.glow.visible = on; glowChanged = true; }
    });
    return refresh() || glowChanged;
  }

  function dispose() {
    disposed = true;
    items.forEach(function (it) {
      it.st.screen.material.map = null;
      it.texture.dispose();
    });
    items.clear();
    images.forEach(function (rec) { rec.img.onload = null; rec.img.onerror = null; });
    images.clear();
  }

  update({});
  return { update, dispose };
}
