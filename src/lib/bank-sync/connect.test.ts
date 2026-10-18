import { describe, expect, it, vi } from "vitest";

import { completeConnect, startConnect, type ConnectApi, type ConnectStore } from "./connect";
import { BankSyncError } from "./errors";

const NOW = new Date("2026-10-02T08:00:00Z");
const BANK = { name: "Caisse d'Epargne Ile-de-France", country: "FR", maximum_consent_validity: 90 * 86400 };

function fakes() {
  const api = {
    getAspsps: vi.fn<ConnectApi["getAspsps"]>(async () => [BANK]),
    startAuth: vi.fn<ConnectApi["startAuth"]>(async () => ({ url: "https://bank.example/login" })),
    createSession: vi.fn<ConnectApi["createSession"]>(async () => ({
      session_id: "s1",
      accounts: [
        { uid: "u1", name: "Compte de cheques", account_id: { iban: "FR7600001234" }, currency: "EUR" },
        { uid: "u2", name: null, product: null, account_id: { iban: "FR7600005678" } },
      ],
      access: { valid_until: "2027-03-31T00:00:00Z" },
    })),
    deleteSession: vi.fn<ConnectApi["deleteSession"]>(async () => {}),
  } satisfies ConnectApi;
  const store = {
    deletePendingBefore: vi.fn<ConnectStore["deletePendingBefore"]>(async () => {}),
    createPending: vi.fn<ConnectStore["createPending"]>(async () => {}),
    findPendingByState: vi.fn<ConnectStore["findPendingByState"]>(async (_user, state) =>
      state === "good" ? { id: "c1", validUntil: new Date("2026-12-31T00:00:00Z") } : null,
    ),
    deletePending: vi.fn<ConnectStore["deletePending"]>(async () => {}),
    activate: vi.fn<ConnectStore["activate"]>(async () => ({ reconnected: false, replacedSessionId: null })),
    ownsConnection: vi.fn<ConnectStore["ownsConnection"]>(async (_user, id) => id === "mine"),
  } satisfies ConnectStore;
  return { api, store };
}

describe("startConnect", () => {
  it("stores a pending connection with the bank's shorter consent and returns the bank's URL", async () => {
    const { api, store } = fakes();
    const result = await startConnect({
      api,
      store,
      userId: "u",
      aspsp: { name: BANK.name, country: "FR" },
      redirectUrl: "http://localhost:3000/api/bank-sync/callback",
      state: "st",
      now: NOW,
    });
    expect(result).toEqual({ ok: true, url: "https://bank.example/login" });
    const validUntil = new Date(NOW.getTime() + 90 * 86400 * 1000);
    expect(store.createPending).toHaveBeenCalledWith("u", {
      aspspName: BANK.name,
      aspspCountry: "FR",
      authState: "st",
      validUntil,
    });
    expect(store.deletePendingBefore).toHaveBeenCalledWith("u", new Date(NOW.getTime() - 3600_000));
    expect(api.startAuth).toHaveBeenCalledWith(expect.objectContaining({ validUntil, state: "st" }));
  });

  it("refuses a bank the API doesn't list", async () => {
    const { api, store } = fakes();
    const result = await startConnect({
      api,
      store,
      userId: "u",
      aspsp: { name: "Nope", country: "FR" },
      redirectUrl: "x",
      state: "st",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, code: "unknown_bank" });
    expect(store.createPending).not.toHaveBeenCalled();
  });

  it("returns the error code when Enable Banking fails", async () => {
    const { api, store } = fakes();
    api.getAspsps.mockRejectedValueOnce(new BankSyncError("unauthorized", 401));
    const result = await startConnect({ api, store, userId: "u", aspsp: BANK, redirectUrl: "x", state: "s", now: NOW });
    expect(result).toEqual({ ok: false, code: "unauthorized" });
  });
});

describe("completeConnect", () => {
  it("activates the pending connection with the bank's accounts", async () => {
    const { api, store } = fakes();
    const result = await completeConnect({ api, store, userId: "u", params: { code: "c", state: "good" }, now: NOW });
    expect(result).toEqual({ ok: true, connectionId: "c1", reconnected: false });
    expect(store.activate).toHaveBeenCalledWith("u", "c1", {
      sessionId: "s1",
      validUntil: new Date("2027-03-31T00:00:00Z"),
      connectedAt: NOW,
      accounts: [
        { bankAccountUid: "u1", displayName: "Compte de cheques", ibanLast4: "1234", currency: "EUR", identificationHash: null },
        { bankAccountUid: "u2", displayName: "•• 5678", ibanLast4: "5678", currency: null, identificationHash: null },
      ],
    });
  });

  it("rejects a missing, unknown or other user's state without calling the bank", async () => {
    const { api, store } = fakes();
    for (const state of [undefined, "forged"]) {
      const result = await completeConnect({ api, store, userId: "u", params: { code: "c", state }, now: NOW });
      expect(result).toEqual({ ok: false, code: "invalid_state" });
    }
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it("drops the pending connection when the user cancels at the bank", async () => {
    const { api, store } = fakes();
    const result = await completeConnect({
      api,
      store,
      userId: "u",
      params: { error: "access_denied", state: "good" },
      now: NOW,
    });
    expect(result).toEqual({ ok: false, code: "denied" });
    expect(store.deletePending).toHaveBeenCalledWith("u", "c1");
  });

  it("drops the pending connection when the session can't be created", async () => {
    const { api, store } = fakes();
    api.createSession.mockRejectedValueOnce(new BankSyncError("bank_unavailable", 503));
    const result = await completeConnect({ api, store, userId: "u", params: { code: "c", state: "good" }, now: NOW });
    expect(result).toEqual({ ok: false, code: "bank_unavailable" });
    expect(store.deletePending).toHaveBeenCalledWith("u", "c1");
    expect(store.activate).not.toHaveBeenCalled();
  });
});

describe("reconnect", () => {
  const start = (store: ReturnType<typeof fakes>["store"], api: ReturnType<typeof fakes>["api"], id: string) =>
    startConnect({ api, store, userId: "u", aspsp: BANK, redirectUrl: "x", state: "st", now: NOW, replacesConnectionId: id });

  it("stores the connection it replaces on the pending row", async () => {
    const { api, store } = fakes();
    expect((await start(store, api, "mine")).ok).toBe(true);
    expect(store.createPending).toHaveBeenCalledWith("u", expect.objectContaining({ replacesConnectionId: "mine" }));
  });

  it("refuses a connection that isn't the user's, before touching the bank", async () => {
    const { api, store } = fakes();
    expect(await start(store, api, "theirs")).toEqual({ ok: false, code: "not_found" });
    expect(store.createPending).not.toHaveBeenCalled();
    expect(api.startAuth).not.toHaveBeenCalled();
  });

  it("ends the old session after activating, and reports the reconnect", async () => {
    const { api, store } = fakes();
    store.activate.mockResolvedValueOnce({ reconnected: true, replacedSessionId: "old-session" });
    const result = await completeConnect({ api, store, userId: "u", params: { code: "c", state: "good" }, now: NOW });
    expect(result).toEqual({ ok: true, connectionId: "c1", reconnected: true });
    expect(api.deleteSession).toHaveBeenCalledWith("old-session");
  });

  it("still succeeds when ending the old session fails", async () => {
    const { api, store } = fakes();
    store.activate.mockResolvedValueOnce({ reconnected: true, replacedSessionId: "old-session" });
    api.deleteSession.mockRejectedValueOnce(new BankSyncError("network"));
    const result = await completeConnect({ api, store, userId: "u", params: { code: "c", state: "good" }, now: NOW });
    expect(result.ok).toBe(true);
  });
});
