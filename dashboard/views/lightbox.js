// Assurity Web Guardian - image lightbox. NOT a routed view.
// Native <dialog> opened with showModal(): the platform provides focus
// trapping, Escape-to-close and an inert background. Not a route, so Back
// does not reopen it. DOM is built with createElement / textContent only.
// No window/document access at import time.

let dialogEl = null;
let lastOpener = null;

function getDialog() {
  if (dialogEl && dialogEl.isConnected) return dialogEl;
  let d = document.getElementById("lightbox");
  if (!d) {
    d = document.createElement("dialog");
    d.id = "lightbox";
    d.setAttribute("aria-label", "Image viewer");
    document.body.appendChild(d);
  }
  if (!d.__awgBound) {
    d.__awgBound = true;
    // Fires for Escape, the Close button and backdrop-free closes alike.
    d.addEventListener("close", () => {
      while (d.firstChild) d.removeChild(d.firstChild);
      const opener = lastOpener;
      lastOpener = null;
      if (opener && typeof opener.focus === "function" && opener.isConnected !== false) {
        opener.focus();
      }
    });
  }
  dialogEl = d;
  return d;
}

/** Close the lightbox if open; focus returns to the opener via the close event. */
export function closeLightbox() {
  const d = dialogEl || document.getElementById("lightbox");
  if (d && d.open) d.close();
}

/**
 * Open the lightbox with a full-size image and its caption.
 * img: { src, alt, caption }; openerEl: the control that gets focus back.
 */
export function openLightbox(img, openerEl) {
  const o = img && typeof img === "object" ? img : {};
  const d = getDialog();
  while (d.firstChild) d.removeChild(d.firstChild);
  lastOpener = openerEl || (document.activeElement !== document.body ? document.activeElement : null);

  const body = document.createElement("div");
  body.className = "lightbox__body";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn lightbox__close";
  close.textContent = "Close image";
  close.addEventListener("click", () => d.close());
  body.appendChild(close);

  const fig = document.createElement("figure");
  fig.className = "figure";
  const image = document.createElement("img");
  image.className = "lightbox__img";
  image.setAttribute("alt", String(o.alt === undefined || o.alt === null ? "" : o.alt));
  image.setAttribute("decoding", "async");
  const msg = document.createElement("p");
  msg.className = "muted";
  msg.hidden = true;
  image.addEventListener("error", () => {
    image.hidden = true;
    msg.textContent = "Image could not be loaded";
    msg.hidden = false;
  });
  image.setAttribute("src", String(o.src || ""));
  fig.appendChild(image);
  fig.appendChild(msg);
  if (o.caption) {
    const cap = document.createElement("figcaption");
    cap.className = "caption";
    cap.textContent = String(o.caption);
    fig.appendChild(cap);
  }
  body.appendChild(fig);
  d.appendChild(body);

  if (!d.open) d.showModal();
  close.focus();
}
