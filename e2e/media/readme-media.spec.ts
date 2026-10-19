import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { shiftSampleToMonth } from "../../src/lib/import/shift-sample-dates";
import { expect, test, waitForStreamedContent } from "../fixtures";
import { parisToday } from "../helpers/dates";
import { chooseCsv } from "../helpers/imports";

// Makes docs/screenshots/*: phone screens and a short GIF for the README, from the synthetic sample
// export only. Run with `pnpm media:generate`; it is not part of `pnpm test:e2e`.

const OUT = path.join(__dirname, "..", "..", "docs", "screenshots");
const SAMPLE = readFileSync(path.join(__dirname, "..", "..", "docs", "samples", "sample-export.csv"), "latin1");
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" } as const;

test.use(PHONE);

/** First day of the month `back` months before `today`'s month, as `YYYY-MM-DD` (string maths). */
function monthStart(today: string, back: number): string {
  const [y, m] = today.split("-").map(Number);
  const index = y * 12 + (m - 1) - back;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** Fails when a screen shows an email or a local URL, so media can never leak either. */
async function shoot(page: Page, name: string) {
  await waitForStreamedContent(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const text = await page.locator("body").innerText();
  expect(text, `${name}: an email or localhost is visible`).not.toMatch(/@|localhost/);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/** Touch-style drag through pointer events, slow enough for the recording to show the motion. */
async function slowSwipe(row: ReturnType<Page["locator"]>, dx: number) {
  await row.evaluate(async (el, distance) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - distance / 2;
    const y = rect.top + rect.height / 2;
    const fire = (type: string, clientX: number) =>
      el.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", isPrimary: true, clientX, clientY: y }),
      );
    fire("pointerdown", x);
    for (let step = 1; step <= 12; step++) {
      fire("pointermove", x + (distance * step) / 12);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    fire("pointerup", x + distance);
  }, dx);
}

// A white dot follows the pointer so the GIF shows where the finger is. Injected in the recording
// context only; no app code is involved.
const TOUCH_DOT = `
  addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.45);transform:translate(-50%,-50%);display:none";
    document.body.appendChild(dot);
    const move = (e) => { dot.style.display = "block"; dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px"; };
    addEventListener("pointerdown", move, true);
    addEventListener("pointermove", move, true);
    addEventListener("pointerup", () => { dot.style.display = "none"; }, true);
  });
`;

test("README screenshots and GIF", async ({ page, browser, baseURL, sql, workerUser, workerStorageState }, testInfo) => {
  testInfo.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  const today = parisToday();
  const uid = workerUser.id;
  const must = (rows: { count: number }, what: string) => {
    if (rows.count < 1) throw new Error(`seed changed nothing: ${what}`);
  };

  await sql`update users set name = 'Alex' where id = ${uid}`;

  // 1. Import the sample, dates moved to the current month. Left unvalidated on purpose.
  await page.goto("/import");
  await chooseCsv(page, { name: "export.csv", mimeType: "text/csv", buffer: Buffer.from(shiftSampleToMonth(SAMPLE, today), "latin1") });
  const preview = page.getByRole("region", { name: "Import preview" });
  await expect(preview.getByTestId("import-flows")).toBeVisible();
  await shoot(page, "import");
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
  await expect(page.getByRole("region", { name: "Import result" }).getByText(/transactions imported/)).toBeVisible();

  // 2. Seeds the UI cannot make quickly: confirmed regular payments, balance, budgets, a goal.
  must(await sql`update recurring set status = 'confirmed' where user_id = ${uid} and status = 'detected'`, "recurring");
  const [main] = await sql`select id from accounts where user_id = ${uid} and not savings order by created_at limit 1`;
  await sql`
    insert into balance_checkpoints (user_id, account_id, date, amount_cents, source)
    values (${uid}, ${main.id}, ${monthStart(today, 2)}, 245000, 'manual')`;
  for (const [name, cents] of [["Alimentation", 45000], ["Loisirs et vacances", 15000], ["Transports", 12000], ["Shopping et services", 8000]] as const) {
    must(
      await sql`
        insert into category_budgets (category_id, user_id, amount_cents)
        select id, ${uid}, ${cents} from categories where user_id = ${uid} and parent_id is null and lower(name) = lower(${name})`,
      `budget ${name}`,
    );
  }
  const [savings] = await sql`insert into accounts (user_id, name, savings) values (${uid}, 'Savings', true) returning id`;
  await sql`
    insert into balance_checkpoints (user_id, account_id, date, amount_cents, source)
    values (${uid}, ${savings.id}, ${today}, 62000, 'manual')`;
  const nextYear = Number(today.slice(0, 4)) + 1;
  await sql`
    insert into savings_goals (user_id, name, target_cents, target_date, icon, account_id, start_cents, start_date)
    values (${uid}, 'Summer trip', 150000, ${`${nextYear}-06-01`}, '🏖️', ${savings.id}, 0, ${monthStart(today, 0)})`;

  // 3. Screens.
  for (const [route, name] of [["/", "home"], ["/transactions", "transactions"], ["/budget", "budget"], ["/recurring", "recurring"], ["/year", "year"]] as const) {
    await page.goto(route);
    await shoot(page, name);
  }
  const icon = await page.request.get(`${baseURL}/apple-icon`);
  expect(icon.ok()).toBe(true);
  writeFileSync(path.join(OUT, "icon.png"), await icon.body());

  // 4. The GIF: swipe rows to validate them, the app's fast path.
  const videoDir = testInfo.outputPath("video");
  const context = await browser.newContext({
    ...PHONE,
    baseURL,
    storageState: workerStorageState,
    recordVideo: { dir: videoDir, size: { width: 390, height: 844 } },
  });
  await context.addInitScript(TOUCH_DOT);
  const rec = await context.newPage();
  await rec.goto("/transactions");
  const list = rec.getByRole("list", { name: "Transactions" });
  const rows = list.getByRole("button", { name: /^Categorize: / });
  await rec.waitForTimeout(1200);

  // Each swipe validates the first row still waiting; the amber ring turns into a green ✓ and the count drops.
  for (let i = 0; i < 3; i++) {
    const waiting = rows.filter({ has: rec.getByTestId("row-to-review") });
    const before = await waiting.count();
    await slowSwipe(waiting.first(), 220);
    await expect(waiting).toHaveCount(before - 1);
    await rec.waitForTimeout(900);
  }

  const video = rec.video();
  await context.close();
  const webm = await video!.path();

  const gif = path.join(OUT, "categorize.gif");
  const makeGif = (fps: number) => {
    try {
      execFileSync("ffmpeg", [
        "-y", "-ss", "0.5", "-i", webm,
        "-vf", `fps=${fps},scale=320:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
        "-loop", "0", gif,
      ], { stdio: "ignore" });
    } catch {
      throw new Error("ffmpeg not found or failed: install it to make the GIF");
    }
  };
  makeGif(12);
  if (statSync(gif).size > 3_000_000) makeGif(10);
  expect(statSync(gif).size).toBeLessThan(3_000_000);
});
