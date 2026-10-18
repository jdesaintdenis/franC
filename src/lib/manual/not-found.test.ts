import { expect, it } from "vitest";

import { isNotFound } from "./not-found";

it("is not found only after 7 full days", () => {
  expect(isNotFound("2026-09-29", "2026-10-06")).toBe(false);
  expect(isNotFound("2026-09-28", "2026-10-06")).toBe(true);
  expect(isNotFound("2026-10-06", "2026-10-06")).toBe(false);
});
