// Render-on-demand loop. No DOM access at import; the host, document, raf and
// IntersectionObserver are passed in or read lazily inside createLoop.
// Requirements 16.5 and 16.6.

// Pure decision: may a frame be scheduled now?
export function canSchedule(s) {
  return !s.scheduled && s.visible && !s.hidden && !s.disposed;
}

export function createLoop(opts) {
  const host = opts.host;
  const doc = opts.document || (typeof document !== "undefined" ? document : null);
  const raf = opts.requestAnimationFrame || ((fn) => requestAnimationFrame(fn));
  const caf = opts.cancelAnimationFrame || ((id) => cancelAnimationFrame(id));
  const update = opts.update || (() => {});
  const render = opts.render;
  const animating = opts.animating || (() => false);
  const onFrame = opts.onFrame || (() => {});
  const IO = opts.IntersectionObserver !== undefined
    ? opts.IntersectionObserver
    : (typeof IntersectionObserver !== "undefined" ? IntersectionObserver : null);

  let scheduled = false;
  let visible = true;
  let disposed = false;
  let frames = 0;
  let rafId = 0;
  let observer = null;
  let pendingRender = false;

  function hidden() {
    return !!(doc && doc.hidden);
  }

  function writeCount() {
    if (host && host.dataset) host.dataset.frameCount = String(frames);
  }

  function frame(now) {
    scheduled = false;
    rafId = 0;
    if (disposed) return;
    pendingRender = false;
    update(now);
    render();
    frames += 1;
    writeCount();
    onFrame(now, frames);
    if (animating()) requestRender();
  }

  function requestRender() {
    if (canSchedule({ scheduled, visible, hidden: hidden(), disposed })) {
      scheduled = true;
      rafId = raf(frame);
    } else {
      // Remember the request so we draw once when visible again.
      pendingRender = true;
    }
  }

  function onVisibility() {
    if (!hidden() && visible) requestRender();
  }

  function onIntersect(entries) {
    const last = entries && entries.length ? entries[entries.length - 1] : null;
    if (!last) return;
    visible = !!last.isIntersecting;
    if (visible) requestRender();
  }

  if (doc && doc.addEventListener) doc.addEventListener("visibilitychange", onVisibility);
  if (IO && host) {
    observer = new IO(onIntersect);
    observer.observe(host);
  }
  writeCount();

  return {
    requestRender,
    get frames() { return frames; },
    get visible() { return visible; },
    get pending() { return pendingRender; },
    setVisible(v) {
      visible = !!v;
      if (visible) requestRender();
    },
    dispose() {
      disposed = true;
      if (rafId) caf(rafId);
      rafId = 0;
      scheduled = false;
      if (doc && doc.removeEventListener) doc.removeEventListener("visibilitychange", onVisibility);
      if (observer) observer.disconnect();
      observer = null;
    },
  };
}
