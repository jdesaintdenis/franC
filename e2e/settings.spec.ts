import { expect, signInFresh, test } from "./fixtures";

test("sign-out from Settings returns to /login, and / then redirects to login", async ({
  page,
  context,
  baseURL,
  workerUser,
}) => {
  // A session of its own: signing out ends only the session in use, so the worker's
  // shared one stays valid for the specs that run after this one.
  await signInFresh(context, baseURL!, workerUser);

  await page.goto("/settings");
  await expect(page.getByText(workerUser.email)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
});
