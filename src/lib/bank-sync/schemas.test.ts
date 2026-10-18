import { describe, expect, it } from "vitest";
import { aspspsResponseSchema, authResponseSchema, sessionResponseSchema } from "./schemas";

describe("schemas", () => {
  it("parses aspsps with unknown fields", () => {
    const r = aspspsResponseSchema.parse({
      aspsps: [{ name: "Mock ASPSP", country: "FR", maximum_consent_validity: 7776000, extra: 1, psu_types: ["personal"] }],
      more: true,
    });
    expect(r.aspsps[0].maximum_consent_validity).toBe(7776000);
  });

  it("parses auth", () => {
    expect(authResponseSchema.parse({ url: "https://bank.test/x", authorization_id: "a", foo: 1 }).url).toBe(
      "https://bank.test/x",
    );
    expect(authResponseSchema.safeParse({ url: "nope" }).success).toBe(false);
  });

  it("parses a normal session", () => {
    const r = sessionResponseSchema.parse({
      session_id: "s1",
      accounts: [{ uid: "u1", account_id: { iban: "FR7612345" }, name: "Compte", currency: "EUR", other: 1 }],
      access: { valid_until: "2027-03-31T00:00:00Z" },
      aspsp: { name: "Caisse d'Epargne", country: "FR" },
    });
    expect(r.accounts[0].account_id?.iban).toBe("FR7612345");
    expect(r.access?.valid_until).toBe("2027-03-31T00:00:00Z");
  });

  it("uses accounts_data when accounts is a string array", () => {
    const r = sessionResponseSchema.parse({
      session_id: "s1",
      accounts: ["u1", "u2"],
      accounts_data: [{ uid: "u1", name: "A" }, { uid: "u2", name: "B" }],
    });
    expect(r.accounts.map((a) => a.name)).toEqual(["A", "B"]);
  });

  it("makes bare objects from a string array without details", () => {
    const r = sessionResponseSchema.parse({ session_id: "s1", accounts: ["u1"] });
    expect(r.accounts).toEqual([{ uid: "u1" }]);
  });

  it("rejects a session without id", () => {
    expect(sessionResponseSchema.safeParse({ accounts: [] }).success).toBe(false);
  });
});
