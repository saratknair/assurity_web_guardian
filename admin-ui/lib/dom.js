// Small DOM helpers. Text is always set with textContent; no HTML strings are ever parsed.

export function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (v === null || v === undefined) continue;
      if (key === "text") node.textContent = String(v);
      else node.setAttribute(key, String(v));
    }
  }
  if (children) for (const c of children) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

/** Fetch JSON from the console API. Throws Error with a readable message on failure. */
export async function api(path, options) {
  const init = { headers: { Accept: "application/json" } };
  if (options && options.body !== undefined) {
    init.method = "POST";
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new Error("Could not reach the console server.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) {
    const reason = data && typeof data.error === "string" ? data.error : "Request failed (" + res.status + ").";
    throw new Error(reason);
  }
  return data;
}
