import type { Page } from "@playwright/test";

/** Minimal audit sink; the Telemetry_Emitter implements this in Phase 4. */
export interface AuditSink {
  audit(event: { type: string; reason: string; detail?: string }): void;
}

/** No-op sink for contexts without telemetry wired yet. */
export const noopAudit: AuditSink = { audit: () => {} };

// Conservative PII heuristics (Req 11.3, 11.4). Field is blocked if its
// name/type/autocomplete signals personal data, or the value matches PII shapes.
const PII_NAME = /(email|e-mail|phone|mobile|tel|name|first.?name|last.?name|surname|address|postcode|zip|dob|birth|ssn|passport|credit|card|cvv|iban|account)/i;
const PII_VALUE = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // email
  /\b\+?\d[\d\s().-]{6,}\d\b/,                       // phone-ish
  /\b\d{13,19}\b/,                                   // card-ish
];

export function looksLikePii(fieldName: string, value: string): boolean {
  if (PII_NAME.test(fieldName)) return true;
  return PII_VALUE.some((re) => re.test(value));
}

/**
 * GuardedPage wraps a Playwright Page to block unsafe actions (Req 11):
 *  - form submission is blocked and audited;
 *  - filling a field with PII is blocked and audited.
 * It never submits a production form and never enters personal data.
 */
export class GuardedPage {
  constructor(
    public readonly page: Page,
    private readonly audit: AuditSink = noopAudit,
  ) {}

  /** Blocked: the system never submits a production form (Req 11.1, 11.2). */
  async submit(): Promise<never> {
    this.audit.audit({ type: "blocked-action", reason: "form-submit-blocked" });
    throw new Error("Form submission is blocked by safety policy (Req 11.2).");
  }

  /** Fills a field only if the value is not PII (Req 11.3, 11.4). */
  async fill(selector: string, value: string): Promise<void> {
    if (looksLikePii(selector, value)) {
      this.audit.audit({
        type: "blocked-action",
        reason: "pii-populate-blocked",
        detail: selector,
      });
      throw new Error("Populating a field with personal information is blocked (Req 11.4).");
    }
    await this.page.fill(selector, value);
  }
}
