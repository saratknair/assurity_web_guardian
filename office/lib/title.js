// Product title shown in the page title and header.
// Plain ES module, ASCII-only, no DOM access.

export const DEFAULT_TITLE = "Web Guardian";

/** The index's displayTitle when it is a non-empty string, else the default title. */
export function titleFrom(index) {
  const t = index && typeof index.displayTitle === "string" ? index.displayTitle.trim() : "";
  return t === "" ? DEFAULT_TITLE : t;
}
