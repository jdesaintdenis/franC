import { devices } from "@playwright/test";

import { expect, test } from "./fixtures";
import { openStartingBalance } from "./helpers/manage";

const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

test("a focused field in a sheet stays visible when the viewport shrinks (phone keyboard)", async ({ page }) => {
  await page.goto("/accounts");
  // e2e/fixtures.ts gives every worker's user a "Main account".
  const sheet = await openStartingBalance(page, "Main account");
  const field = sheet.getByLabel("Balance", { exact: true });
  await expect(field).toBeFocused();
  // Playwright has no on-screen keyboard: shrinking the viewport is the closest stand-in.
  await page.setViewportSize({ width: 412, height: 380 });
  await expect(field).toBeInViewport();
  const box = await sheet.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(380 + 1);
});
