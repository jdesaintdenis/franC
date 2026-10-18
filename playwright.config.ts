import { generateKeyPairSync } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// The production build is the default: pages are compiled once, the service worker is
// active, and dev-only React behaviour stays out of the timings. E2E_DEV=1 (pnpm
// test:e2e:dev) runs against `next dev` for quick iteration while writing a spec.
const DEV = process.env.E2E_DEV === "1";

// Each worker signs in as its own user (e2e/fixtures.ts), so specs no longer share data.
// Files run in parallel; tests inside a file keep their order.
const WORKERS = Number(process.env.PW_WORKERS) || (process.env.CI ? 2 : 4);

// Throwaway RSA key pair for the fake Enable Banking server (nothing is written to disk).
// Playwright loads this file in the main process and in every worker, so the pair is made
// once and shared through the environment, which workers inherit.
const FAKE_EB_PORT = 3100;
// Shared with the specs through the environment, like the key pair below.
const E2E_CRON_SECRET = (process.env.E2E_CRON_SECRET ??= "e2e-cron-secret-0123456789");
const FAKE_EB_APP_ID = "00000000-0000-4000-8000-0000000000eb";
if (!process.env.FAKE_EB_PRIVATE_KEY_B64 || !process.env.FAKE_EB_PUBLIC_KEY_B64) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.FAKE_EB_PRIVATE_KEY_B64 = Buffer.from(
    privateKey.export({ type: "pkcs8", format: "pem" }),
  ).toString("base64");
  process.env.FAKE_EB_PUBLIC_KEY_B64 = Buffer.from(
    publicKey.export({ type: "spki", format: "pem" }),
  ).toString("base64");
}

export default defineConfig({
  testDir: "./e2e",
  // README media generator: run by `pnpm media:generate`, not by the suite.
  testIgnore: ["media/**"],
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: WORKERS,
  reporter: process.env.CI ? [["dot"], ["html", { open: "never" }]] : "dot",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: process.env.CI ? "retain-on-failure" : "on-first-retry",
    // Existing specs use English selectors; the French UI is tested explicitly.
    locale: "en-US",
    // Tests don't wait on animations or click into a running view transition. e2e/feedback.spec.ts
    // turns motion back on to check the animated paths still work.
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
          : {},
      },
    },
  ],
  webServer: [
    {
      command: "pnpm exec tsx e2e/helpers/fake-enable-banking-server.ts",
      url: `http://localhost:${FAKE_EB_PORT}/health`,
      timeout: 30_000,
      // Never reused: a fake left over from another run would check JWTs against another key.
      reuseExistingServer: false,
      env: {
        FAKE_EB_PORT: String(FAKE_EB_PORT),
        FAKE_EB_APP_ID,
        FAKE_EB_PUBLIC_KEY: process.env.FAKE_EB_PUBLIC_KEY_B64,
      },
    },
    {
      command: DEV ? "pnpm dev" : "pnpm build && pnpm start",
      url: "http://localhost:3000",
      timeout: DEV ? 120_000 : 600_000,
      reuseExistingServer: !process.env.CI,
      // Bank sync talks to the fake above, never to a real bank. A reused server keeps its own env.
      env: {
        ENABLE_BANKING_APP_ID: FAKE_EB_APP_ID,
        ENABLE_BANKING_PRIVATE_KEY: process.env.FAKE_EB_PRIVATE_KEY_B64,
        ENABLE_BANKING_API_ORIGIN: `http://localhost:${FAKE_EB_PORT}`,
        // e2e/bank-daily-sync.spec.ts calls /api/cron/daily with this bearer token.
        CRON_SECRET: E2E_CRON_SECRET,
        // Every worker's user (e2e/fixtures.ts names them e2e+w<n>@…) may use bank sync.
        BANK_SYNC_EMAILS: Array.from({ length: 16 }, (_, n) => {
          const [local, domain] = (process.env.E2E_USER_EMAIL ?? "e2e@example.com").split("@");
          return `${local}+w${n}@${domain}`;
        }).join(","),
      },
    },
  ],
});
