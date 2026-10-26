import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/property/**/*.test.ts"],
    environment: "node",
  },
});
