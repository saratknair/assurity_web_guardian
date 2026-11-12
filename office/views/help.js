// Keyboard shortcut table (requirements 4.9, 6.4, 6.10). Printed inside the
// <details id="shortcut-help"> element; the host is #help-content.
//
// createHelp(host, handlers) -> { update(model), dispose() }
//   model    : ignored (the table is static); update() renders once.
//   handlers : unused.
// Character-key shortcuts work only while focus is inside the Diorama group.
// DOM is built with lib/dom.js only. No DOM access at import time.

import { el, setChildren } from "../lib/dom.js";

export const SHORTCUT_SCOPE =
  "These keys work only while the 3D view (Diorama) has keyboard focus. Tab always moves focus out of it.";

export const SHORTCUTS = Object.freeze([
  Object.freeze({ keys: "Arrow keys", action: "Orbit left, right, up, down" }),
  Object.freeze({ keys: "Plus / Minus", action: "Zoom in / out" }),
  Object.freeze({ keys: "Shift + Arrow keys", action: "Pan" }),
  Object.freeze({ keys: "1 to 6", action: "Focus Station 1 to 6 (list order)" }),
  Object.freeze({ keys: "0", action: "Reset view" }),
  Object.freeze({ keys: "Space", action: "Play or pause" }),
  Object.freeze({ keys: "Comma / Period", action: "Previous / next event" }),
  Object.freeze({ keys: "Escape", action: "Return focus to the Station list" }),
]);

export function createHelp(host, handlers) {
  void handlers;
  let rendered = false;

  function update(_model) {
    if (rendered || !host) return;
    rendered = true;
    const rows = SHORTCUTS.map((s) =>
      el("tr", null, [el("th", { scope: "row", text: s.keys }), el("td", { text: s.action })]));
    setChildren(host, [
      el("p", { text: SHORTCUT_SCOPE }),
      el("div", { class: "table-scroll" }, [
        el("table", { class: "shortcuts" }, [
          el("caption", { text: "Keyboard shortcuts for the 3D view" }),
          el("thead", null, el("tr", null, [
            el("th", { scope: "col", text: "Key (focus in Diorama)" }),
            el("th", { scope: "col", text: "Action" }),
          ])),
          el("tbody", null, rows),
        ]),
      ]),
      el("p", { text: "Toolbar controls use the native button, slider and list keys only." }),
    ]);
  }

  function dispose() {
    if (host) setChildren(host, []);
    rendered = false;
  }

  return { update, dispose };
}
