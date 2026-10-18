import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { test as base, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: path.join(__dirname, "..", ".env.local"), quiet: true });

export { expect };

export type E2EUser = { id: string; email: string; password: string };

const BASE_EMAIL = process.env.E2E_USER_EMAIL ?? "e2e@example.com";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "e2e-password-123";

/** One user per parallel worker, so workers never see each other's data. */
export function workerEmail(parallelIndex: number): string {
  const [local, domain] = BASE_EMAIL.split("@");
  return `${local}+w${parallelIndex}@${domain}`;
}

/**
 * Deletes the user (everything they own cascades from the users row) and recreates them
 * with SQL rather than the sign-up endpoint, so ALLOWED_EMAILS needs no per-worker entries.
 * The rows mirror what sign-up writes: the user, a credential login and the default bank
 * account. welcome_completed_at is set because the worker user stands for someone already
 * set up; e2e/first-run.spec.ts covers the new-user path with its own user.
 */
async function recreateUser(sql: postgres.Sql, email: string, password: string): Promise<E2EUser> {
  const id = randomUUID();
  const hash = await hashPassword(password);
  await sql.begin(async (tx) => {
    await tx`delete from users where email = ${email}`;
    await tx`
      insert into users (id, name, email, email_verified, welcome_completed_at)
      values (${id}, 'E2E User', ${email}, false, now())`;
    await tx`
      insert into auth_accounts (id, account_id, provider_id, user_id, password, updated_at)
      values (${randomUUID()}, ${id}, 'credential', ${id}, ${hash}, now())`;
    await tx`insert into accounts (user_id, name) values (${id}, 'Main account')`;
  });
  return { id, email, password };
}

/**
 * Signs in through the API; the cookie lands in whatever `request` belongs to (a browser
 * context's request shares its cookie jar). Better Auth rate-limits sign-in in production,
 * with one bucket for every localhost caller, so a 429 waits for Retry-After and tries again.
 */
export async function signIn(request: APIRequestContext, baseURL: string, user: E2EUser): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await request.post(`${baseURL}/api/auth/sign-in/email`, {
      data: { email: user.email, password: user.password },
      // Better Auth rejects cookie-less POSTs without an Origin it trusts.
      headers: { Origin: baseURL },
      failOnStatusCode: false,
    });
    if (res.ok()) return;
    if (res.status() !== 429) throw new Error(`sign-in failed for ${user.email}: ${res.status()}`);
    const retryAfter = Number(res.headers()["retry-after"] ?? "2");
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + Math.random()) * 1000));
  }
  throw new Error(`sign-in for ${user.email} kept hitting the rate limit`);
}

/** Gives `context` its own new session, so signing out there leaves the worker's session alive. */
export async function signInFresh(context: BrowserContext, baseURL: string, user: E2EUser): Promise<void> {
  await context.clearCookies();
  await signIn(context.request, baseURL, user);
}

/**
 * Waits until React has revealed every streamed Suspense boundary. A server-rendered page
 * streams each boundary's content into a hidden <div id="S:n"> and swaps it in a moment
 * later (React batches reveals). Until then a locator can match both copies and fail in
 * strict mode with "resolved to 2 elements".
 */
export async function waitForStreamedContent(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'));
}

/** Arbitrary key of the advisory lock that serializes the tests that connect a bank across workers. */
const BANK_LOCK_KEY = 4949;

type WorkerFixtures = {
  sql: postgres.Sql;
  workerUser: E2EUser;
  workerStorageState: string;
};

// Fixture callbacks name their second argument `provide`, not Playwright's usual `use`,
// so the React hooks lint rule doesn't mistake it for React's use().
type TestFixtures = { bankLock: void };

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Every full page load (goto, reload) waits for the streamed content to be revealed. It first waits for the
  // history step a closed sheet takes (src/components/ui/back-closes.ts), which would cancel the load.
  page: async ({ page }, provide) => {
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    // Bounded, so a history step that never lands fails here by name instead of eating the test timeout.
    const historySettled = () =>
      page.waitForFunction(() => !document.documentElement.hasAttribute("data-history-busy"), undefined, { timeout: 10_000 });
    page.goto = async (url, options) => {
      await historySettled();
      const response = await goto(url, options);
      await waitForStreamedContent(page);
      return response;
    };
    page.reload = async (options) => {
      await historySettled();
      const response = await reload(options);
      await waitForStreamedContent(page);
      return response;
    };
    await provide(page);
  },

  sql: [
    async ({}, provide) => {
      const sql = postgres(process.env.DATABASE_URL ?? "", { onnotice: () => {} });
      await provide(sql);
      await sql.end();
    },
    { scope: "worker" },
  ],

  // /api/cron/daily syncs every worker's connections, so a spec that calls it would change what another
  // worker's bank test sees (a "3 new transactions" that became "nothing new"). Tests in bank-*.spec.ts
  // files, or tagged @bank, therefore run one at a time across workers, through a Postgres advisory lock
  // held on its own connection. Waiting for it isn't counted against the test timeout.
  bankLock: [
    async ({ sql }, provide, testInfo) => {
      const needed = path.basename(testInfo.file).startsWith("bank-") || testInfo.tags.includes("@bank");
      if (!needed) return provide();
      const connection = await sql.reserve();
      try {
        await connection`select pg_advisory_lock(${BANK_LOCK_KEY})`;
        await provide();
      } finally {
        await connection`select pg_advisory_unlock(${BANK_LOCK_KEY})`;
        connection.release();
      }
    },
    { auto: true, timeout: 0 },
  ],

  workerUser: [
    async ({ sql }, provide, workerInfo) => {
      await provide(await recreateUser(sql, workerEmail(workerInfo.parallelIndex), PASSWORD));
    },
    { scope: "worker" },
  ],

  workerStorageState: [
    async ({ workerUser, playwright }, provide, workerInfo) => {
      const baseURL = workerInfo.project.use.baseURL ?? "http://localhost:3000";
      // Named after the user, so runs with different E2E_USER_EMAIL against one server don't
      // overwrite each other's sign-in.
      const file = path.join(__dirname, ".auth", `${workerUser.email.replace(/[^a-z0-9]/gi, "_")}.json`);
      mkdirSync(path.dirname(file), { recursive: true });
      const request = await playwright.request.newContext();
      await signIn(request, baseURL, workerUser);
      await request.storageState({ path: file });
      await request.dispose();
      await provide(file);
    },
    { scope: "worker" },
  ],

  // Every test starts signed in as its worker's user; a spec opts out with
  // test.use({ storageState: { cookies: [], origins: [] } }).
  storageState: ({ workerStorageState }, provide) => provide(workerStorageState),
});
