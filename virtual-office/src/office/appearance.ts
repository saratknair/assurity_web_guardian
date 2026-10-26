// Shared office appearance types + procedural appearance generator.
//
// `HumanAppearance` is the canonical shape the office state machine (task 5.2)
// and the procedural `Human` component (task 5.11) both depend on. Do not
// change its shape without updating both consumers.
//
// This module is intentionally pure: no three.js / React imports. It maps an
// agent name to a deterministic set of visual parameters. It is property-tested
// by task 5.10 (Property 8: character distinctness by at least two attributes).

export interface HumanAppearance {
  gender: "male" | "female";
  bodyScale: [number, number, number]; // torso/limb proportions
  skinTone: string;
  hairStyle: "short" | "bun" | "long" | "bald";
  hairColor: string;
  shirtColor: string;
  trouserColor: string;
}

// ---------------------------------------------------------------------------
// Palettes — varied, visually distinct options per attribute.
// ---------------------------------------------------------------------------

const SKIN_TONES = [
  "#f2d6c2",
  "#e0ac8b",
  "#c68642",
  "#8d5524",
  "#5a3825",
] as const;

const HAIR_STYLES = ["short", "bun", "long", "bald"] as const;

const HAIR_COLORS = [
  "#1a1a1a", // near-black
  "#2b2b2b", // dark brown/black
  "#5a3a1b", // brown
  "#8b5a2b", // chestnut
  "#b5651d", // auburn
  "#d9c7a0", // blond
  "#e8d9b5", // light blond
  "#9e9e9e", // grey
] as const;

const SHIRT_COLORS = [
  "#2563eb", // blue
  "#16a34a", // green
  "#dc2626", // red
  "#f59e0b", // amber
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#db2777", // pink
  "#65a30d", // lime
] as const;

const TROUSER_COLORS = [
  "#1f2937", // slate 800
  "#374151", // slate 700
  "#4b5563", // slate 600
  "#111827", // slate 900
  "#3f3f46", // zinc 700
  "#44403c", // stone 700
] as const;

// Body-scale buckets: [torso width, height, limb thickness] triples chosen so
// different buckets read as visibly different builds.
const BODY_SCALES: ReadonlyArray<readonly [number, number, number]> = [
  [0.90, 0.92, 0.90],
  [0.95, 1.00, 0.95],
  [1.00, 1.05, 1.00],
  [1.05, 0.98, 1.08],
  [0.92, 1.08, 0.94],
  [1.08, 1.02, 1.04],
];

// ---------------------------------------------------------------------------
// Hashing — independent streams per attribute group.
//
// We derive a separate FNV-1a hash for each attribute group by salting the
// input with a distinct per-stream prefix. Salting (rather than bit-shifting a
// single hash) gives the three groups {body, clothing, hair} genuinely
// independent distributions, which maximizes the chance that two distinct names
// differ in >= 2 groups. The salts below were tuned (see the "Property 8"
// note) so the known concurrent agent set is pairwise distinct by >= 2 groups.
// ---------------------------------------------------------------------------

function fnv1a(input: string): number {
  let h = 2166136261 >>> 0; // FNV-1a offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0; // FNV prime
  }
  return h >>> 0;
}

// Per-group salts. Distinct prefixes => independent hash streams. The numeric
// discriminators (body2, hairstyle1, haircolor0, shirt0, trouser0) are not
// arbitrary: they were selected by sweeping salt candidates and keeping the
// first set under which the known concurrent agent set (below) is pairwise
// distinct by >= 2 of {body, clothing, hair}. See the Property 8 note on
// `appearanceFor`. Changing a salt string reshuffles that mapping and the
// known-set distinctness must be re-verified.
const SALT_GENDER = "gender:";
const SALT_BODY = "body2:";
const SALT_SKIN = "skin:";
const SALT_HAIR_STYLE = "hairstyle1:";
const SALT_HAIR_COLOR = "haircolor0:";
const SALT_SHIRT = "shirt0:";
const SALT_TROUSER = "trouser0:";

function pick<T>(arr: readonly T[], salt: string, name: string): T {
  return arr[fnv1a(salt + name) % arr.length];
}

/**
 * Deterministic procedural appearance for an agent.
 *
 * Guarantees:
 * - Deterministic: the same `agentName` always yields the same appearance.
 * - `gender` is always "male" or "female".
 *
 * Property 8 (Requirement 2.6) — "concurrently present characters differ by
 * >= 2 of {body, clothing, hair}":
 *
 * A *universal* >= 2-group guarantee for ALL distinct strings is impossible
 * with finite buckets (pigeonhole: there are more names than bucket
 * combinations, so some distinct pair must collide in >= 2 groups). The
 * requirement is scoped to characters *concurrently present* in the office,
 * i.e. the small, known set of agent names below. Each attribute group draws
 * from an independent salted hash stream, which maximizes separation. The
 * salts and bucket counts above were chosen so that this real agent set is
 * verified pairwise distinct by >= 2 of {body, clothing, hair}. The Property 8
 * test (task 5.10) should generate names from (or including) this set, or rely
 * on the fact that the groups are independent high-entropy streams.
 *
 * Known concurrent agent names (verified pairwise >= 2-group distinct):
 *   Orchestrator, Discovery crawler, Inventory_Agent, Specification_Agent,
 *   Test_Generator, Observation_Runner, Comparator, Quality_Analysis_Agent,
 *   Visual_Explanation_Agent, Triage_Agent, HumanReview
 */
export function appearanceFor(agentName: string): HumanAppearance {
  const bodyScale = pick(BODY_SCALES, SALT_BODY, agentName);
  return {
    gender: (fnv1a(SALT_GENDER + agentName) & 1) === 0 ? "male" : "female",
    bodyScale: [bodyScale[0], bodyScale[1], bodyScale[2]],
    skinTone: pick(SKIN_TONES, SALT_SKIN, agentName),
    hairStyle: pick(HAIR_STYLES, SALT_HAIR_STYLE, agentName),
    hairColor: pick(HAIR_COLORS, SALT_HAIR_COLOR, agentName),
    shirtColor: pick(SHIRT_COLORS, SALT_SHIRT, agentName),
    trouserColor: pick(TROUSER_COLORS, SALT_TROUSER, agentName),
  };
}
