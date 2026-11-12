/**
 * Keyboard-operable Stations list (alternative to clicking in the Diorama).
 *
 * createStationsList(host, handlers) -> { update(model), dispose() }
 *
 * model: {
 *   selectedId: string|null,       // selected Station id
 *   activeIds?: string[]           // Station ids with an active Timeline_Entry now
 * }
 *
 * handlers: onSelectStation(id)
 *
 * Each Station is a native button inside a list item; Enter and Space work.
 * update() never moves focus. No DOM access at import time.
 */
import { el, setText, setChildren } from "../lib/dom.js";
import { STATIONS } from "../lib/stations.js";

export function createStationsList(host, handlers) {
  const h = handlers || {};
  const items = {};
  const last = {};
  const buttons = [];

  const list = el("ul", { class: "stations-list", role: "list" });
  for (let i = 0; i < STATIONS.length; i++) {
    const s = STATIONS[i];
    const state = el("span", { class: "muted" });
    const btn = el("button", { type: "button", class: "btn", "aria-pressed": "false" }, [
      el("span", { text: s.name }), " ", state,
    ]);
    const desc = el("p", { class: "muted", text: s.description });
    const onClick = function () {
      if (typeof h.onSelectStation === "function") h.onSelectStation(s.id);
    };
    btn.addEventListener("click", onClick);
    buttons.push({ btn: btn, fn: onClick });
    items[s.id] = { btn: btn, state: state };
    list.appendChild(el("li", { dataset: { station: s.id } }, [btn, desc]));
  }
  setChildren(host, list);

  function update(model) {
    const m = model || {};
    const active = Array.isArray(m.activeIds) ? m.activeIds : [];
    for (let i = 0; i < STATIONS.length; i++) {
      const id = STATIONS[i].id;
      const it = items[id];
      const selected = m.selectedId === id;
      const isActive = active.indexOf(id) !== -1;
      if (last[id + ":s"] !== selected) {
        last[id + ":s"] = selected;
        it.btn.setAttribute("aria-pressed", selected ? "true" : "false");
      }
      if (last[id + ":a"] !== isActive) {
        last[id + ":a"] = isActive;
        setText(it.state, isActive ? "(active now)" : "");
      }
    }
  }

  function dispose() {
    for (let i = 0; i < buttons.length; i++) buttons[i].btn.removeEventListener("click", buttons[i].fn);
    buttons.length = 0;
    setChildren(host, null);
  }

  update({});
  return { update: update, dispose: dispose };
}
