// Safe DOM helpers: elements are built with createElement and text nodes only.
// No markup strings are ever parsed. No document access at import time.

// el(tag, attrs, children): attrs may be null. Keys: "class", "text", "dataset"
// (object), or a plain attribute name. Event handler attributes (on*) are
// refused; attach listeners with addEventListener instead.
export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    const keys = Object.keys(attrs);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = String(v);
      else if (k === "text") node.appendChild(document.createTextNode(String(v)));
      else if (k === "dataset") {
        const dk = Object.keys(v);
        for (let j = 0; j < dk.length; j++) node.dataset[dk[j]] = String(v[dk[j]]);
      } else if (/^on/i.test(k)) {
        throw new Error("el(): event handler attributes are not allowed: " + k);
      } else node.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(node, children);
  return node;
}

// Append strings (as text nodes), nodes, or arrays of either.
export function append(parent, children) {
  if (children === null || children === undefined || children === false) return parent;
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) append(parent, children[i]);
  } else if (typeof children === "object" && typeof children.nodeType === "number") {
    parent.appendChild(children);
  } else {
    parent.appendChild(document.createTextNode(String(children)));
  }
  return parent;
}

export function text(s) {
  return document.createTextNode(s === null || s === undefined ? "" : String(s));
}

// Replace all children of a node with the given children.
export function setChildren(parent, children) {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  return append(parent, children);
}

// Set text content only (never markup).
export function setText(node, s) {
  node.textContent = s === null || s === undefined ? "" : String(s);
  return node;
}
