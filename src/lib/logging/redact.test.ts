import { describe, expect, it } from "vitest";

import { redactConsoleArgs, redactError } from "./redact";

const LABEL = "CARTE 12/03 SUPER SECRET MERCHANT";
const AMOUNT = "-123456";

function drizzleLikeError(): Error {
  const cause = Object.assign(new Error(`duplicate key value violates unique constraint (${LABEL})`), {
    name: "PostgresError",
    code: "23505",
    detail: `Key (label)=(${LABEL}) already exists.`,
  });
  const err = new Error(
    `Failed query: insert into "transactions" ("label_raw", "amount_cents") values ($1, $2)\nparams: ${LABEL},${AMOUNT}`,
  );
  return Object.assign(err, {
    name: "DrizzleQueryError",
    query: 'insert into "transactions" ...',
    params: [LABEL, AMOUNT],
    cause,
  });
}

function everything(value: unknown): string {
  return JSON.stringify(value) + String(value) + JSON.stringify(value, Object.getOwnPropertyNames(Object(value)));
}

describe("redactError", () => {
  it("leaks nothing from a Drizzle query error and keeps the SQLSTATE", () => {
    const safe = redactError(drizzleLikeError());
    const out = everything(safe);
    expect(out).not.toContain(LABEL);
    expect(out).not.toContain(AMOUNT);
    expect(out).not.toContain("insert into");
    expect(safe).toEqual({ name: "DrizzleQueryError", code: "23505" });
  });

  it("treats a wrapped DB error in the cause chain as sensitive", () => {
    const wrapper = new Error("Something failed", { cause: drizzleLikeError() });
    const safe = redactError(wrapper);
    expect(everything(safe)).not.toContain(LABEL);
    expect(safe.message).toBeUndefined();
  });

  it("drops messages that merely contain params:", () => {
    const safe = redactError(new Error(`oops params: ${LABEL}`));
    expect(everything(safe)).not.toContain(LABEL);
  });

  it("keeps the message of a plain error and the digest", () => {
    const err = Object.assign(new Error("Unexpected token"), { digest: "abc123" });
    expect(redactError(err)).toEqual({ name: "Error", message: "Unexpected token", digest: "abc123" });
  });

  it("handles non-errors", () => {
    expect(redactError(`secret ${LABEL}`)).toEqual({ name: "NonError" });
    expect(redactError(null)).toEqual({ name: "NonError" });
  });

  it("survives cyclic cause chains", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as Error & { cause?: unknown }).cause = b;
    expect(() => redactError(a)).not.toThrow();
  });
});

describe("redactConsoleArgs", () => {
  it("replaces errors and query-detail strings, leaves other args alone", () => {
    const out = redactConsoleArgs(["Failed:", drizzleLikeError(), `params: ${LABEL}`, 42]);
    expect(everything(out)).not.toContain(LABEL);
    expect(out[0]).toBe("Failed:");
    expect(out[1]).toBe("DrizzleQueryError code=23505");
    expect(out[3]).toBe(42);
  });
});
