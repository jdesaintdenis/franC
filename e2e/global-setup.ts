import type { FullConfig } from "@playwright/test";

/**
 * A reused server must match the mode asked for: running the default (production) suite
 * against a forgotten `next dev` silently gives dev timings and dev-only failures. The
 * app's CSP allows 'unsafe-eval' only in development, so it tells the two apart.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const res = await fetch(`${baseURL}/login`);
  const isDevServer = (res.headers.get("content-security-policy") ?? "").includes("'unsafe-eval'");
  const wantDev = process.env.E2E_DEV === "1";
  if (isDevServer && !wantDev) {
    throw new Error(`${baseURL} is a dev server. Stop it to test the production build, or run pnpm test:e2e:dev.`);
  }
  if (!isDevServer && wantDev) {
    throw new Error(`${baseURL} is a production server, but E2E_DEV=1 asks for the dev server.`);
  }
}
