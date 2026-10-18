import { createFakeEnableBanking } from "./fake-enable-banking";

// Runnable entry for Playwright's webServer (`tsx e2e/helpers/fake-enable-banking-server.ts`).
// Env: FAKE_EB_PORT (default 3100), FAKE_EB_APP_ID, FAKE_EB_PUBLIC_KEY (the public PEM, or
// base64 of it; base64 is what playwright.config.ts passes since PEMs are awkward in env vars).
const port = Number(process.env.FAKE_EB_PORT) || 3100;
const appId = process.env.FAKE_EB_APP_ID;
const rawKey = process.env.FAKE_EB_PUBLIC_KEY;
if (!appId || !rawKey) {
  console.error("FAKE_EB_APP_ID and FAKE_EB_PUBLIC_KEY are required");
  process.exit(1);
}
const publicKeyPem = rawKey.includes("BEGIN")
  ? rawKey.replace(/\\n/g, "\n")
  : Buffer.from(rawKey, "base64").toString("utf8");

createFakeEnableBanking({ publicKeyPem, appId, port }).listen(port, () => {
  console.log(`fake Enable Banking listening on ${port}`);
});
