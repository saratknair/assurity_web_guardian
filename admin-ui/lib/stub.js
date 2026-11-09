// Placeholder body for sections whose real content lands in a later task.
export function renderNotAvailable(root, el, label) {
  root.appendChild(el("p", { text: label + " is not available yet. It will appear here in a later update." }));
}
