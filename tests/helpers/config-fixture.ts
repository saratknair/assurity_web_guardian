/** A complete, valid app config with placeholder values. */
export function completeAppConfig(): Record<string, any> {
  return {
    approvedDomain: "example.com",
    baseUrl: "https://example.com",
    seedFilePath: "config/page-seed.json",
    limits: {
      pages: 10,
      crawlDepth: 2,
      concurrency: 1,
      requestSpacingMs: 1000,
      retries: 2,
      navTimeoutMs: 30000,
      runTimeoutMs: 600000,
    },
    retention: { maxRuns: 1, maxAgeDays: 1 },
    viewports: {
      desktop: { width: 1, height: 1 },
      mobile: { width: 1, height: 1 },
    },
  };
}
