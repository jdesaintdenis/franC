import { describe, expect, it } from "vitest";

import { parseAccountParam, resolveHomeAccount } from "./account";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("parseAccountParam", () => {
  it("accepts one of the user's accounts", () => {
    expect(parseAccountParam(A, [A, B])).toBe(A);
  });
  it("ignores an account that is not the user's", () => {
    expect(parseAccountParam(B, [A])).toBeNull();
  });
  it("ignores malformed, missing and repeated values", () => {
    expect(parseAccountParam("nope", [A])).toBeNull();
    expect(parseAccountParam(undefined, [A])).toBeNull();
    expect(parseAccountParam([A, B], [A, B])).toBeNull();
  });
});

describe("resolveHomeAccount", () => {
  const C = "33333333-3333-4333-8333-333333333333";
  it("shows all accounts without a param or a default", () => {
    expect(resolveHomeAccount(undefined, null, [A, B])).toEqual({ accountId: null, linkParam: null });
  });
  it("opens the default account when the URL names none", () => {
    expect(resolveHomeAccount(undefined, A, [A, B])).toEqual({ accountId: A, linkParam: A });
  });
  it("lets ?account=all win over the default", () => {
    expect(resolveHomeAccount("all", A, [A, B])).toEqual({ accountId: null, linkParam: "all" });
  });
  it("lets an explicit account win over the default", () => {
    expect(resolveHomeAccount(B, A, [A, B])).toEqual({ accountId: B, linkParam: B });
  });
  it("needs no marker for all accounts without a default", () => {
    expect(resolveHomeAccount("all", null, [A, B])).toEqual({ accountId: null, linkParam: null });
  });
  it("ignores a default that is not the user's", () => {
    expect(resolveHomeAccount(undefined, C, [A, B])).toEqual({ accountId: null, linkParam: null });
  });
});
