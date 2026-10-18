import { describe, expect, it } from "vitest";

import { merchantInputErrorCode } from "./error-codes";
import { createMerchantSchema } from "./input";

describe("merchantInputErrorCode", () => {
  it("maps the first issue to a code", () => {
    const parsed = createMerchantSchema.safeParse({ name: "", matchType: "equals", pattern: "X" });
    expect(parsed.success ? null : merchantInputErrorCode(parsed.error.issues)).toBe("nameRequired");
  });

  it("falls back to invalidInput", () => {
    expect(merchantInputErrorCode([{ message: "Invalid input" }])).toBe("invalidInput");
    expect(merchantInputErrorCode([])).toBe("invalidInput");
  });
});
