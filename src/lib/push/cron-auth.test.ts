import { describe, expect, it } from "vitest";

import { isAuthorizedCron } from "./cron-auth";

describe("isAuthorizedCron", () => {
  it("accepts the exact bearer token", () => {
    expect(isAuthorizedCron("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("rejects missing, wrong, differently sized and non-bearer values", () => {
    expect(isAuthorizedCron(null, "s3cret")).toBe(false);
    expect(isAuthorizedCron("Bearer s3creT", "s3cret")).toBe(false);
    expect(isAuthorizedCron("Bearer s3cret2", "s3cret")).toBe(false);
    expect(isAuthorizedCron("Bearer ", "s3cret")).toBe(false);
    expect(isAuthorizedCron("s3cret", "s3cret")).toBe(false);
    expect(isAuthorizedCron("Basic s3cret", "s3cret")).toBe(false);
  });
});
