/**
 * Required-setting checks for the instance configuration files.
 *
 * Each config file has a declarative list of required dotted paths and the
 * type each value must have. A missing or wrongly typed value fails with a
 * message that names the setting, the file and the example file to copy from.
 */

export type SettingType = "string" | "number" | "nonEmptyArray";

export interface RequiredSetting {
  path: string;
  type: SettingType;
}

export const APP_CONFIG_REQUIRED: readonly RequiredSetting[] = [
  { path: "approvedDomain", type: "string" },
  { path: "baseUrl", type: "string" },
  { path: "seedFilePath", type: "string" },
  { path: "limits.pages", type: "number" },
  { path: "limits.crawlDepth", type: "number" },
  { path: "limits.concurrency", type: "number" },
  { path: "limits.requestSpacingMs", type: "number" },
  { path: "limits.retries", type: "number" },
  { path: "limits.navTimeoutMs", type: "number" },
  { path: "limits.runTimeoutMs", type: "number" },
  { path: "retention.maxRuns", type: "number" },
  { path: "retention.maxAgeDays", type: "number" },
  { path: "viewports.desktop.width", type: "number" },
  { path: "viewports.desktop.height", type: "number" },
  { path: "viewports.mobile.width", type: "number" },
  { path: "viewports.mobile.height", type: "number" },
];

export const DOMAIN_CONFIG_REQUIRED: readonly RequiredSetting[] = [
  { path: "domain", type: "string" },
  { path: "baseUrl", type: "string" },
  { path: "approvedSchemes", type: "nonEmptyArray" },
  { path: "maxDiscoveryCount", type: "number" },
  { path: "largeScopeThreshold", type: "number" },
  { path: "requestSpacingMs", type: "number" },
  { path: "scopeFile", type: "string" },
];

export const PAGE_SEED_REQUIRED: readonly RequiredSetting[] = [
  { path: "maxUrls", type: "number" },
  { path: "approvedUrls", type: "nonEmptyArray" },
];

function lookup(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function matches(value: unknown, type: SettingType): boolean {
  switch (type) {
    case "string":
      return typeof value === "string" && value.length > 0;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "nonEmptyArray":
      return Array.isArray(value) && value.length > 0;
  }
}

const TYPE_LABEL: Record<SettingType, string> = {
  string: "a non-empty string",
  number: "a number",
  nonEmptyArray: "a non-empty array",
};

/**
 * Throw when any required setting is missing or has the wrong type.
 * `file` and `exampleFile` are repo-relative paths used in the message.
 */
export function assertRequiredSettings(
  value: unknown,
  required: readonly RequiredSetting[],
  file: string,
  exampleFile: string,
): void {
  for (const { path, type } of required) {
    const v = lookup(value, path);
    if (v === undefined || v === null) {
      throw new Error(
        `Missing required setting "${path}" in ${file}. See ${exampleFile}.`,
      );
    }
    if (!matches(v, type)) {
      throw new Error(
        `Invalid setting "${path}" in ${file}: expected ${TYPE_LABEL[type]}. See ${exampleFile}.`,
      );
    }
  }
}
