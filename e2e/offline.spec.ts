import { devices } from "@playwright/test";

import { expect, test } from "./fixtures";

test.use({ ...devices["Pixel 7"] });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

const BANNER = "You're offline — data can't be loaded or saved until you reconnect.";

test("offline banner appears when offline and disappears when back online", async ({ page, context }) => {
  await expect(page.getByRole("status").filter({ hasText: BANNER })).toHaveCount(0);

  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: BANNER })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: BANNER })).toHaveCount(0);
});

test("production SW: offline navigation shows the offline page and no cached data", async ({
  page,
  context,
}) => {
  // The service worker is disabled under `next dev` (pnpm test:e2e:dev).
  test.skip(process.env.E2E_DEV === "1", "requires a production build");

  await page.goto("/transactions");
  await expect(page.getByRole("heading", { level: 1, name: "Transactions", exact: true })).toBeVisible();

  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload();
  }
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  await context.setOffline(true);
  // Offline navigation aborts the request; the SW answers with the fallback.
  await page.goto("/transactions").catch(() => undefined);

  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Transactions" })).toHaveCount(0);
  await expect(page.getByText(/€/)).toHaveCount(0);

  const cacheNames = await page.evaluate(() => caches.keys());
  for (const legacy of ["pages", "pages-rsc", "pages-rsc-prefetch", "apis", "others"]) {
    expect(cacheNames).not.toContain(legacy);
  }
});

test("production SW: a CSV shared to the app opens its import preview, and the file isn't kept", async ({ page }) => {
  test.skip(process.env.E2E_DEV === "1", "requires a production build");

  await page.goto("/import");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();

  // What Android does on share: a multipart POST to the manifest's share_target action.
  const csv = [
    "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation",
    `02/09/2025;SHARED ${Date.now()};PRLV SHARED;REF1;REF1-;Prelevement;;;-4,20;;02/09/2025;02/09/2025;0`,
  ].join("\n");
  const redirected = await page.evaluate(async (body) => {
    const form = new FormData();
    form.set("file", new File([body], "shared.csv", { type: "text/csv" }));
    const response = await fetch("/import/share", { method: "POST", body: form });
    return new URL(response.url).pathname + new URL(response.url).search;
  }, csv);
  expect(redirected).toBe("/import?shared=1");

  await page.goto("/import?shared=1");
  const preview = page.getByRole("region", { name: "Import preview" });
  await expect(preview.getByText("shared.csv")).toBeVisible();
  await expect(preview.getByTestId("import-new-count")).toHaveText("1");
  expect(await page.evaluate(() => caches.has("share-target"))).toBe(false);
});
