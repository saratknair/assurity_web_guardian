// Tiny observable store. No DOM. get() returns the current state object;
// set(patch) shallow-merges and notifies subscribers only when a value changed.

export function createStore(initial) {
  let state = Object.freeze({ ...(initial || {}) });
  const subs = new Set();

  function get() {
    return state;
  }

  function set(patch) {
    if (!patch || typeof patch !== "object") return state;
    let changed = false;
    for (const k of Object.keys(patch)) {
      if (!Object.is(state[k], patch[k])) { changed = true; break; }
    }
    if (!changed) return state;
    const prev = state;
    state = Object.freeze({ ...prev, ...patch });
    for (const fn of Array.from(subs)) fn(state, prev);
    return state;
  }

  function subscribe(fn) {
    if (typeof fn !== "function") throw new TypeError("subscribe needs a function");
    subs.add(fn);
    return function unsubscribe() { subs.delete(fn); };
  }

  return { get, set, subscribe };
}
