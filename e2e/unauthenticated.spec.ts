import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

test("unauthenticated / redirects to /login with next", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
});

test("unauthenticated /transactions redirects to /login with next", async ({ page }) => {
  await page.goto("/transactions");
  await expect(page).toHaveURL(/\/login\?next=%2Ftransactions$/);
});

test("unauthenticated export request is sent to login, not served as CSV", async ({ page }) => {
  await page.goto("/api/export/transactions");
  await expect(page).toHaveURL(/\/login/);
});

test("wrong password shows the error", async ({ page, workerUser }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(workerUser.email);
  await page.getByLabel("Password").fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.locator("form").getByRole("alert")).toHaveText("Invalid email or password");
  await expect(page).toHaveURL(/\/login/);
});

test("login via the form lands on / and shows the home heading", async ({ page, workerUser }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(workerUser.email);
  await page.getByLabel("Password").fill(workerUser.password);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
});

test("signing up with a non-allowlisted email shows the rejection message", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`not-allowed-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("some-password-123");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page.locator("form").getByRole("alert")).toHaveText("Sign-up is not allowed for this email");
  await expect(page).toHaveURL(/\/signup/);
});

test("a11y: /login and /signup have no serious axe violations and an h1", async ({ page }) => {
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
    expect(blocking, `axe violations on ${path}`).toEqual([]);
  }
});
