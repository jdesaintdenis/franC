import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

// README screenshots and GIF (`pnpm media:generate`). Same servers and fixtures as the E2E suite,
// but one worker and real motion, and never part of `pnpm test:e2e` (see testIgnore there).
export default defineConfig({
  ...base,
  testDir: "./e2e/media",
  testIgnore: [],
  workers: 1,
  reporter: "line",
  use: { ...base.use, reducedMotion: "no-preference" },
});
