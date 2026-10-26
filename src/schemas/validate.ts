import AjvModule, { type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";
// ESM/CJS interop (nodenext): Ajv v8 and ajv-formats ship as CJS.
const Ajv = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as unknown as (new (opts?: unknown) => any);
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as unknown as (ajv: unknown) => void;


/**
 * Agent hand-off and record schemas (Req 17). Validation is required before a
 * receiver acts; an invalid OR incomplete discovery hand-off is rejected and
 * recorded in the audit trail (Req 1.11, 1.12, 8.9, 2.6).
 */
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const correlated = {
  correlationId: { type: "string", pattern: "^cor_" },
  taskId: { type: "string", pattern: "^task_" },
};

export const discoveryHandoffSchema = {
  $id: "discovery.handoff",
  type: "object",
  required: ["correlationId", "taskId", "approvedPages", "pagesRequiringReview", "externalLinks"],
  additionalProperties: false,
  properties: {
    ...correlated,
    approvedPages: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        required: ["url", "depth", "source"],
        additionalProperties: false,
        properties: {
          url: { type: "string", format: "uri" },
          depth: { type: "integer", minimum: 0, maximum: 2 },
          source: { const: "page-seed-file" },
        },
      },
    },
    pagesRequiringReview: {
      type: "array",
      items: {
        type: "object",
        required: ["url", "discoveredFrom"],
        additionalProperties: false,
        properties: {
          url: { type: "string", format: "uri" },
          discoveredFrom: { type: "string", format: "uri" },
        },
      },
    },
    externalLinks: { type: "array", items: { type: "string", format: "uri" } },
  },
} as const;

export const inventoryHandoffSchema = {
  $id: "inventory.handoff",
  type: "object",
  required: ["correlationId", "taskId", "pages"],
  additionalProperties: false,
  properties: {
    ...correlated,
    partial: { type: "boolean" },
    failedViewport: { type: ["string", "null"] },
    pages: {
      type: "array",
      items: {
        type: "object",
        required: ["url", "title", "headings", "links", "images", "buttons", "forms"],
        additionalProperties: false,
        properties: {
          url: { type: "string", format: "uri" },
          title: { type: "string" },
          headings: { type: "array", items: { type: "object" } },
          links: { type: "array", items: { type: "object" } },
          images: { type: "array", items: { type: "object" } },
          buttons: { type: "array", items: { type: "string" } },
          // Form fields carry NO `value` property (PII cannot be recorded).
          forms: { type: "array", items: { type: "object" } },
        },
      },
    },
  },
} as const;

export const comparisonHandoffSchema = {
  $id: "comparison.handoff",
  type: "object",
  required: ["correlationId", "taskId", "page", "outcomes"],
  additionalProperties: false,
  properties: {
    ...correlated,
    page: { type: "string", format: "uri" },
    outcomes: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "classification", "detail"],
        additionalProperties: true,
        properties: {
          kind: { enum: ["failed-check", "observed-website-change", "visual-finding"] },
          classification: {
            enum: ["deterministic-test-evidence", "observed-website-change"],
          },
          detail: { type: "string" },
        },
      },
    },
  },
} as const;

const validators: Record<string, ValidateFunction> = {
  "discovery.handoff": ajv.compile(discoveryHandoffSchema),
  "inventory.handoff": ajv.compile(inventoryHandoffSchema),
  "comparison.handoff": ajv.compile(comparisonHandoffSchema),
};

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateHandoff(schemaId: string, data: unknown): ValidationResult {
  const v = validators[schemaId];
  if (!v) return { valid: false, errors: [`unknown schema: ${schemaId}`] };
  const ok = v(data) as boolean;
  const errors = ok ? [] : (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
  return { valid: ok, errors };
}

/**
 * Discovery completeness check (Req 1.12): even when schema-valid, a hand-off
 * that omits a known approved page or a known review page must be rejected.
 */
export function discoveryHandoffComplete(
  data: { approvedPages?: unknown[]; pagesRequiringReview?: unknown[] },
  expectedApproved: number,
  expectedReview: number,
): boolean {
  return (
    (data.approvedPages?.length ?? -1) === expectedApproved &&
    (data.pagesRequiringReview?.length ?? -1) === expectedReview
  );
}

