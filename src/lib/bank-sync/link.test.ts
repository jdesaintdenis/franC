import { describe, expect, it } from "vitest";

import { defaultLinkChoices, ibanLast4, matchReconnectedAccounts, uniqueAccountName, type ReconnectAccount } from "./link";

describe("uniqueAccountName", () => {
  it("keeps a free name and numbers a taken one, ignoring case", () => {
    expect(uniqueAccountName("Livret A", ["Main"])).toBe("Livret A");
    expect(uniqueAccountName("Livret A", ["livret a", "Livret A 2"])).toBe("Livret A 3");
  });

  it("stays within the 50-character limit", () => {
    const long = "x".repeat(60);
    const name = uniqueAccountName(long, ["x".repeat(50)]);
    expect(name).toHaveLength(50);
    expect(name.endsWith(" 2")).toBe(true);
  });
});

describe("defaultLinkChoices", () => {
  const bank = [
    { uid: "b1", displayName: "Compte de cheques" },
    { uid: "b2", displayName: "Livret A" },
  ];

  it("picks the account with the same name first", () => {
    const choices = defaultLinkChoices(bank, [
      { id: "a1", name: "Main account", linked: false },
      { id: "a2", name: "livret a", linked: false },
    ]);
    expect(choices.get("b2")).toEqual({ kind: "existing", accountId: "a2" });
    expect(choices.get("b1")).toEqual({ kind: "new", name: "Compte de cheques" });
  });

  it("gives the only free account to the first bank account, new accounts to the rest", () => {
    const choices = defaultLinkChoices(bank, [{ id: "a1", name: "Main account", linked: false }]);
    expect(choices.get("b1")).toEqual({ kind: "existing", accountId: "a1" });
    expect(choices.get("b2")).toEqual({ kind: "new", name: "Livret A" });
  });

  it("never proposes an account another bank account already feeds", () => {
    const choices = defaultLinkChoices(bank, [{ id: "a1", name: "Livret A", linked: true }]);
    expect(choices.get("b1")).toEqual({ kind: "new", name: "Compte de cheques" });
    expect(choices.get("b2")).toEqual({ kind: "new", name: "Livret A 2" });
  });
});

describe("ibanLast4", () => {
  it("keeps only the last four characters", () => {
    expect(ibanLast4("FR76 3000 3000 0000 0000 0001 234")).toBe("1234");
    expect(ibanLast4(null)).toBeNull();
    expect(ibanLast4("12")).toBeNull();
  });
});

describe("matchReconnectedAccounts", () => {
  const acc = (uid: string, o: Partial<ReconnectAccount> = {}): ReconnectAccount => ({
    bankAccountUid: uid,
    identificationHash: null,
    ibanLast4: null,
    displayName: uid,
    ...o,
  });
  const old = (id: string, o: Partial<ReconnectAccount> = {}) => ({ id, ...acc(`old-${id}`, o) });

  it("matches by uid first", () => {
    const m = matchReconnectedAccounts([old("a", { bankAccountUid: "u1" })], [acc("u1")]);
    expect([...m]).toEqual([["u1", "a"]]);
  });

  it("falls back to the identification hash, then IBAN end plus name", () => {
    const m = matchReconnectedAccounts(
      [old("a", { identificationHash: "h" }), old("b", { ibanLast4: "1234", displayName: "Livret A" })],
      [acc("n1", { identificationHash: "h" }), acc("n2", { ibanLast4: "1234", displayName: "livret a" })],
    );
    expect(Object.fromEntries(m)).toEqual({ n1: "a", n2: "b" });
  });

  it("leaves unmatched accounts out and never reuses an old link", () => {
    const m = matchReconnectedAccounts(
      [old("a", { ibanLast4: "1234", displayName: "X" })],
      [acc("n1", { ibanLast4: "1234", displayName: "X" }), acc("n2", { ibanLast4: "1234", displayName: "X" }), acc("n3")],
    );
    expect(Object.fromEntries(m)).toEqual({ n1: "a" });
  });

  it("does not match on an IBAN end alone", () => {
    expect(matchReconnectedAccounts([old("a", { ibanLast4: "1234", displayName: "A" })], [acc("n", { ibanLast4: "1234", displayName: "B" })]).size).toBe(0);
  });
});
