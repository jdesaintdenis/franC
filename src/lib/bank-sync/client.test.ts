import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEnableBankingClient } from "./client";
import type { EnableBankingConfig } from "./config";
import { BankSyncError } from "./errors";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const config: EnableBankingConfig = { appId: "app-1", privateKey, apiOrigin: "https://api.test" };
const now = () => new Date("2026-10-02T10:00:00Z");

type Call = { url: URL; init: RequestInit };

function setup(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { calls, client: createEnableBankingClient(config, { fetch: fake, now }) };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function bearerVerifies(init: RequestInit): boolean {
  const auth = (init.headers as Record<string, string>).Authorization;
  const [h, b, s] = auth.replace("Bearer ", "").split(".");
  return crypto.verify("sha256", Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, "base64url"));
}

describe("client requests", () => {
  it("getAspsps", async () => {
    const { client, calls } = setup(() => json({ aspsps: [{ name: "Mock ASPSP", country: "FR" }] }));
    const banks = await client.getAspsps("FR");
    expect(banks[0].name).toBe("Mock ASPSP");
    const { url, init } = calls[0];
    expect(init.method).toBe("GET");
    expect(url.origin + url.pathname).toBe("https://api.test/aspsps");
    expect(url.searchParams.get("country")).toBe("FR");
    expect(url.searchParams.get("psu_type")).toBe("personal");
    expect(bearerVerifies(init)).toBe(true);
    expect(init.signal).toBeDefined();
  });

  it("startAuth", async () => {
    const { client, calls } = setup(() => json({ url: "https://bank.test/go" }));
    const out = await client.startAuth({
      aspsp: { name: "Mock ASPSP", country: "FR" },
      validUntil: new Date("2027-03-31T00:00:00Z"),
      redirectUrl: "http://localhost:3000/api/bank-sync/callback",
      state: "st",
    });
    expect(out).toEqual({ url: "https://bank.test/go" });
    const { url, init } = calls[0];
    expect(init.method).toBe("POST");
    expect(url.pathname).toBe("/auth");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(bearerVerifies(init)).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({
      access: { valid_until: "2027-03-31T00:00:00.000Z" },
      aspsp: { name: "Mock ASPSP", country: "FR" },
      state: "st",
      redirect_url: "http://localhost:3000/api/bank-sync/callback",
      psu_type: "personal",
    });
  });

  it("createSession", async () => {
    const { client, calls } = setup(() => json({ session_id: "s1", accounts: ["u1"] }));
    const s = await client.createSession("code1");
    expect(s.accounts).toEqual([{ uid: "u1" }]);
    expect(calls[0].url.pathname).toBe("/sessions");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ code: "code1" });
  });

  it("getBalances reads the balances of an account with the PSU headers", async () => {
    const { client, calls } = setup(() =>
      json({
        balances: [
          { balance_amount: { amount: "12.30", currency: "EUR" }, balance_type: "CLBD", reference_date: "2026-10-01", extra: 1 },
        ],
      }),
    );
    const balances = await client.getBalances("a/b", { psu: { ipAddress: "1.2.3.4", userAgent: "UA" } });
    expect(balances).toMatchObject([{ balance_type: "CLBD", balance_amount: { amount: "12.30", currency: "EUR" } }]);
    expect(calls[0].url.pathname).toBe("/accounts/a%2Fb/balances");
    expect(calls[0].init.method).toBe("GET");
    expect(new Headers(calls[0].init.headers).get("Psu-Ip-Address")).toBe("1.2.3.4");
  });

  it("getBalances rejects a malformed response", async () => {
    const { client } = setup(() => json({ balances: [{ balance_type: "CLBD" }] }));
    await expect(client.getBalances("u")).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("deleteSession encodes the id and treats 404 as success", async () => {
    const { client, calls } = setup(() => new Response("gone", { status: 404 }));
    await expect(client.deleteSession("a/b c")).resolves.toBeUndefined();
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].url.pathname).toBe("/sessions/a%2Fb%20c");
    expect(calls[0].init.body).toBeUndefined();
  });

  it("deleteSession succeeds on 204", async () => {
    const { client } = setup(() => new Response(null, { status: 204 }));
    await expect(client.deleteSession("s1")).resolves.toBeUndefined();
  });
});

describe("client error mapping", () => {
  async function codeOf(p: Promise<unknown>) {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BankSyncError);
    return err as BankSyncError;
  }

  it("maps a 429 with ASPSP_RATE_LIMIT_EXCEEDED to rate_limited", async () => {
    const body = JSON.stringify({ error: "ASPSP_RATE_LIMIT_EXCEEDED", message: "SECRET-IBAN" });
    const { client } = setup(() => new Response(body, { status: 429 }));
    const err = await codeOf(client.getAspsps("FR"));
    expect(err.code).toBe("rate_limited");
    expect(err.status).toBe(429);
    expect(err.message).not.toContain("SECRET");
  });

  it("keeps a 429 with another error as bank_unavailable", async () => {
    const { client } = setup(() => new Response(JSON.stringify({ error: "OTHER" }), { status: 429 }));
    expect((await codeOf(client.getAspsps("FR"))).code).toBe("bank_unavailable");
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "not_found"],
    [429, "bank_unavailable"],
    [500, "bank_unavailable"],
    [503, "bank_unavailable"],
    [400, "bank_unavailable"],
  ])("status %i maps to %s without leaking the body", async (status, code) => {
    const { client } = setup(() => new Response("SECRET-IBAN-FR76", { status }));
    const err = await codeOf(client.getAspsps("FR"));
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
    expect(err.message).not.toContain("SECRET");
  });

  it("maps a fetch throw to network", async () => {
    const { client } = setup(() => {
      throw new TypeError("boom SECRET");
    });
    const err = await codeOf(client.getAspsps("FR"));
    expect(err.code).toBe("network");
    expect(err.message).not.toContain("SECRET");
  });

  it("maps non-JSON and schema failures to invalid_response", async () => {
    expect((await codeOf(setup(() => new Response("<html>")).client.getAspsps("FR"))).code).toBe("invalid_response");
    expect((await codeOf(setup(() => json({ nope: 1 })).client.createSession("c"))).code).toBe("invalid_response");
  });

  it("deleteSession still throws on other failures", async () => {
    const { client } = setup(() => new Response("", { status: 500 }));
    expect((await codeOf(client.deleteSession("s"))).code).toBe("bank_unavailable");
  });
});

describe("getTransactions", () => {
  const tx = (ref: string) => ({
    entry_reference: ref,
    transaction_amount: { amount: "12.30", currency: "EUR" },
    credit_debit_indicator: "DBIT",
    status: "BOOK",
    booking_date: "2026-09-30",
  });

  function paged(pages: Array<{ transactions: unknown[]; continuation_key?: string | null }>) {
    let i = 0;
    return setup(() => json(pages[Math.min(i++, pages.length - 1)]));
  }

  it("follows continuation keys and sends the query and PSU headers", async () => {
    const { client, calls } = paged([
      { transactions: [tx("a")], continuation_key: "k1" },
      { transactions: [tx("b")], continuation_key: null },
    ]);
    const out = await client.getTransactions("uid/1", {
      dateFrom: "2026-07-05",
      status: "BOOK",
      psu: { ipAddress: "203.0.113.7", userAgent: "Phone" },
    });
    expect(out.map((t) => t.entry_reference)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url.pathname).toBe("/accounts/uid%2F1/transactions");
    expect(calls[0].url.searchParams.get("date_from")).toBe("2026-07-05");
    expect(calls[0].url.searchParams.get("transaction_status")).toBe("BOOK");
    expect(calls[0].url.searchParams.has("continuation_key")).toBe(false);
    expect(calls[1].url.searchParams.get("continuation_key")).toBe("k1");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Psu-Ip-Address"]).toBe("203.0.113.7");
    expect(headers["Psu-User-Agent"]).toBe("Phone");
    expect(bearerVerifies(calls[0].init)).toBe(true);
  });

  it("omits the status filter and PSU headers when not asked", async () => {
    const { client, calls } = paged([{ transactions: [] }]);
    await expect(client.getTransactions("u", { dateFrom: "2026-07-05" })).resolves.toEqual([]);
    expect(calls[0].url.searchParams.has("transaction_status")).toBe(false);
    expect(Object.keys(calls[0].init.headers as Record<string, string>)).toEqual(["Authorization"]);
  });

  it("keeps unknown fields and tolerates a numeric amount", async () => {
    const { client } = paged([{ transactions: [{ ...tx("a"), transaction_amount: { amount: 5.5, currency: "EUR" }, extra: 1 }] }]);
    const [t] = await client.getTransactions("u", { dateFrom: "2026-07-05" });
    expect(t.transaction_amount.amount).toBe("5.5");
    expect(t).toHaveProperty("extra", 1);
  });

  it("gives up after 50 pages", async () => {
    const { client, calls } = paged([{ transactions: [], continuation_key: "again" }]);
    await expect(client.getTransactions("u", { dateFrom: "2026-07-05" })).rejects.toMatchObject({ code: "invalid_response" });
    expect(calls).toHaveLength(50);
  });

  it("rejects a malformed transaction", async () => {
    const { client } = paged([{ transactions: [{ entry_reference: "x" }] }]);
    await expect(client.getTransactions("u", { dateFrom: "2026-07-05" })).rejects.toMatchObject({ code: "invalid_response" });
  });
});
