import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import type { PageInventory } from "./inventory-agent.js";

/**
 * Spec_Generator / Specification_Agent (Req 3, 4.2). Turns a deterministic
 * inventory into a Markdown Draft_Specification, marked "draft", written to the
 * Pending_Review_Area. It is NOT a baseline until a human approves it (Req 4.1).
 */
export function generateDraftSpec(inv: PageInventory): string {
  const lines: string[] = [];
  lines.push(`# Draft Specification: ${inv.title || inv.url}`);
  lines.push("");
  lines.push(`- **State:** draft`);
  lines.push(`- **URL:** ${inv.url}`);
  lines.push(`- **Generated:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`> This is an AI/agent-drafted specification. It is NOT a baseline`);
  lines.push(`> until a human approves it through the Approval_Gate.`);
  lines.push("");
  lines.push(`## Title`);
  lines.push(inv.title ? `\`${inv.title}\`` : "_(none)_");
  lines.push("");
  lines.push(`## Headings (${inv.headings.length})`);
  for (const h of inv.headings.slice(0, 50)) lines.push(`- H${h.level}: ${h.text}`);
  lines.push("");
  lines.push(`## Primary Navigation & Links (${inv.links.length})`);
  const internal = inv.links.filter((l) => !l.external);
  const external = inv.links.filter((l) => l.external);
  lines.push(`- Internal links: ${internal.length}`);
  lines.push(`- External links (recorded, never navigated): ${external.length}`);
  lines.push("");
  lines.push(`## Critical Content Expectations`);
  lines.push(`- Document responds with HTTP 2xx/3xx`);
  lines.push(`- Non-empty page title`);
  lines.push(`- At least one visible H1`);
  lines.push(`- Primary navigation present`);
  lines.push("");
  lines.push(`## Images (${inv.images.length})`);
  lines.push(`- Expect all ${inv.images.length} images to load (no broken images)`);
  lines.push("");
  lines.push(`## Buttons (${inv.buttons.length})`);
  for (const b of inv.buttons.slice(0, 30)) lines.push(`- ${b}`);
  lines.push("");
  lines.push(`## Forms (${inv.forms.length})`);
  for (const f of inv.forms) {
    lines.push(`- **${f.name}** — ${f.fields.length} fields, ${f.buttons.length} buttons (never submitted; no PII captured)`);
  }
  lines.push("");
  lines.push(`## Accessibility`);
  lines.push(`- Automated WCAG 2.2 AA (Axe). Automated checks do not establish full`);
  lines.push(`  conformance; manual accessibility testing remains necessary.`);
  lines.push("");
  return lines.join("\n");
}

export interface DraftRef {
  slug: string;
  url: string;
  draftPath: string;
}

/** Writes the draft spec to the pending-review area and returns its reference. */
export function writeDraftSpec(
  inv: PageInventory,
  pendingRoot = "artifacts/pending-review/spec-drafts",
): DraftRef {
  const slug = slugify(inv.url);
  const dir = resolve(pendingRoot);
  mkdirSync(dir, { recursive: true });
  const draftPath = join(dir, `${slug}.draft.md`);
  writeFileSync(draftPath, generateDraftSpec(inv), "utf8");
  return { slug, url: inv.url, draftPath };
}

export function slugify(url: string): string {
  const u = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  return u.toLowerCase() || "home";
}
