import { createHmac, randomBytes, randomUUID, verify } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { isoDaysAgo } from "./dates";
import { fakeTransactionPages } from "./fake-transactions";

// A stand-in for the Enable Banking API so E2E never calls a real bank. It checks the
// JWT like the real one does (RS256, kid = app id, aud, iss, exp) and walks the same
// flow: /auth -> "bank" page -> redirect with code -> /sessions. Nothing is logged.

export type FakeEnableBankingOptions = {
  publicKeyPem: string;
  appId: string;
  port: number;
};

const ASPSP_NAMES = [
  "Caisse d'Epargne Ile-de-France",
  "Caisse d'Epargne Aquitaine Poitou-Charentes",
  "BNP Paribas",
  "Mock ASPSP",
];

const FAKE_ACCOUNTS = [
  { iban: "FR7630003000000000000001234", name: "Compte de cheques", type: "CACC" },
  { iban: "FR7630003000000000000005678", name: "Livret A", type: "SVGS" },
];

type Aspsp = { name: string; country: string };
type Pending = { redirectUrl: string; aspsp: Aspsp; validUntil: string };
type Session = { aspsp: Aspsp; validUntil: string };

function b64urlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function jwtIsValid(authorization: string | undefined, opts: FakeEnableBankingOptions): boolean {
  const match = /^Bearer (\S+)$/.exec(authorization ?? "");
  if (!match) return false;
  const parts = match[1].split(".");
  if (parts.length !== 3) return false;
  try {
    const header: unknown = JSON.parse(b64urlDecode(parts[0]).toString("utf8"));
    const payload: unknown = JSON.parse(b64urlDecode(parts[1]).toString("utf8"));
    if (typeof header !== "object" || header === null) return false;
    if (typeof payload !== "object" || payload === null) return false;
    const h = header as Record<string, unknown>;
    const p = payload as Record<string, unknown>;
    if (h.alg !== "RS256" || h.kid !== opts.appId) return false;
    if (p.aud !== "api.enablebanking.com" || p.iss !== "enablebanking.com") return false;
    if (typeof p.exp !== "number" || p.exp * 1000 <= Date.now()) return false;
    return verify(
      "sha256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      opts.publicKeyPem,
      b64urlDecode(parts[2]),
    );
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function createFakeEnableBanking(opts: FakeEnableBankingOptions): Server {
  const origin = `http://localhost:${opts.port}`;
  const pendingByState = new Map<string, Pending>();
  const codes = new Map<string, Pending>(); // code -> what it grants, deleted once used
  const sessions = new Map<string, Session>();
  // The CLBD amount the balances route serves, in decimal euros. Default "1234.56" (not tied to the
  // fake transactions). Tests change it with `POST /control/balance` {"amount": "2000.00"}, no JWT, like /health.
  let closingBalance = "1234.56";
  // Account uids whose next transactions call answers the bank's daily-limit 429. Keyed by uid (not
  // global) so a spec arming it can't make another worker's sync fail. One call per entry.
  const rateLimited = new Set<string>();

  function redirectBack(res: ServerResponse, redirectUrl: string, params: Record<string, string>) {
    const url = new URL(redirectUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    res.writeHead(302, { location: url.toString() });
    res.end();
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", origin);
    const method = req.method ?? "GET";
    const path = url.pathname;

    if (method === "GET" && path === "/health") return sendJson(res, 200, { ok: true });

    // The "bank's page": opened by the browser, so no JWT.
    if (method === "GET" && path === "/bank/login") {
      const state = url.searchParams.get("state") ?? "";
      const pending = pendingByState.get(state);
      if (!pending) return sendHtml(res, 400, "<!doctype html><title>Fake bank</title><p>Unknown state</p>");
      const q = `state=${encodeURIComponent(state)}`;
      return sendHtml(
        res,
        200,
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fake bank</title></head><body><main><h1>Fake bank</h1><p>${escapeHtml(pending.aspsp.name)}</p><p><a href="/bank/approve?${q}">Approve</a> <a href="/bank/cancel?${q}">Cancel</a></p></main></body></html>`,
      );
    }
    if (method === "GET" && (path === "/bank/approve" || path === "/bank/cancel")) {
      const state = url.searchParams.get("state") ?? "";
      const pending = pendingByState.get(state);
      if (!pending) return sendHtml(res, 400, "<!doctype html><title>Fake bank</title><p>Unknown state</p>");
      if (path === "/bank/cancel") {
        return redirectBack(res, pending.redirectUrl, {
          error: "access_denied",
          error_description: "cancelled",
          state,
        });
      }
      const code = randomBytes(16).toString("hex");
      codes.set(code, pending);
      return redirectBack(res, pending.redirectUrl, { code, state });
    }

    if (method === "POST" && path === "/control/balance") {
      const body = await readJson(req);
      const amount = body ? str(body.amount) : null;
      if (!amount || !/^-?\d+(\.\d{1,2})?$/.test(amount)) return sendJson(res, 400, { error: "invalid_request" });
      closingBalance = amount;
      return sendJson(res, 200, { ok: true });
    }

    // `POST /control/rate-limit` {"uid": "<bank account uid>"}: that account's next transactions call
    // answers 429 ASPSP_RATE_LIMIT_EXCEEDED, like the bank's per-day limit. No JWT, like /health.
    if (method === "POST" && path === "/control/rate-limit") {
      const body = await readJson(req);
      const uid = body ? str(body.uid) : null;
      if (!uid) return sendJson(res, 400, { error: "invalid_request" });
      rateLimited.add(uid);
      return sendJson(res, 200, { ok: true });
    }

    if (!jwtIsValid(req.headers.authorization, opts)) {
      return sendJson(res, 401, { error: "unauthorized" });
    }

    if (method === "GET" && path === "/aspsps") {
      const country = url.searchParams.get("country") ?? "FR";
      return sendJson(res, 200, {
        aspsps: ASPSP_NAMES.map((name) => ({
          name,
          country,
          maximum_consent_validity: 15552000,
          psu_types: ["personal"],
        })),
      });
    }

    if (method === "POST" && path === "/auth") {
      const body = await readJson(req);
      const access = body && isRecord(body.access) ? body.access : null;
      const aspsp = body && isRecord(body.aspsp) ? body.aspsp : null;
      const validUntil = access ? str(access.valid_until) : null;
      const name = aspsp ? str(aspsp.name) : null;
      const country = aspsp ? str(aspsp.country) : null;
      const state = body ? str(body.state) : null;
      const redirectUrl = body ? str(body.redirect_url) : null;
      const psuType = body ? str(body.psu_type) : null;
      if (!validUntil || !name || !country || !state || !redirectUrl || !psuType) {
        return sendJson(res, 400, { error: "invalid_request" });
      }
      pendingByState.set(state, { redirectUrl, aspsp: { name, country }, validUntil });
      return sendJson(res, 200, {
        url: `${origin}/bank/login?state=${encodeURIComponent(state)}`,
        authorization_id: randomUUID(),
      });
    }

    if (method === "POST" && path === "/sessions") {
      const body = await readJson(req);
      const code = body ? str(body.code) : null;
      const granted = code ? codes.get(code) : undefined;
      if (!code || !granted) return sendJson(res, 400, { error: "invalid_code" });
      codes.delete(code);
      const sessionId = randomUUID();
      sessions.set(sessionId, { aspsp: granted.aspsp, validUntil: granted.validUntil });
      return sendJson(res, 200, {
        session_id: sessionId,
        // Derived from the session id so uids are stable for a given session.
        accounts: FAKE_ACCOUNTS.map((a, i) => ({
          uid: uuidFrom(`${sessionId}:${i}`),
          // Stable per account across sessions (the uid isn't), so Reconnect pairs accounts by it.
          identification_hash: uuidFrom(`hash:${a.iban}`),
          account_id: { iban: a.iban },
          name: a.name,
          currency: "EUR",
          cash_account_type: a.type,
        })),
        aspsp: granted.aspsp,
        access: { valid_until: granted.validUntil },
      });
    }

    // Every account gets the same transactions; `continuation_key` is the next page's index.
    if (method === "GET" && /^\/accounts\/[^/]+\/transactions$/.test(path)) {
      const uid = decodeURIComponent(path.split("/")[2]);
      if (rateLimited.delete(uid)) return sendJson(res, 429, { error: "ASPSP_RATE_LIMIT_EXCEEDED" });
      if (!url.searchParams.get("date_from")) return sendJson(res, 400, { error: "invalid_request" });
      const pages = fakeTransactionPages();
      const index = Number(url.searchParams.get("continuation_key") ?? "0");
      const status = url.searchParams.get("transaction_status");
      const page = (pages[index] ?? []).filter((t) => !status || t.status === status);
      const next = index + 1 < pages.length ? String(index + 1) : null;
      return sendJson(res, 200, { transactions: page, continuation_key: next });
    }

    // Every account gets the same balances: a booked closing one (CLBD, the one franC reads) and an
    // expected one (XPCD, with pending payments) that franC must ignore.
    if (method === "GET" && /^\/accounts\/[^/]+\/balances$/.test(path)) {
      return sendJson(res, 200, {
        balances: [
          {
            name: "Solde comptable",
            balance_type: "CLBD",
            balance_amount: { amount: closingBalance, currency: "EUR" },
            reference_date: isoDaysAgo(0),
            last_change_date_time: new Date().toISOString(),
          },
          {
            name: "Solde en cours",
            balance_type: "XPCD",
            balance_amount: { amount: "999999.00", currency: "EUR" },
            reference_date: isoDaysAgo(0),
          },
        ],
      });
    }

    const del = /^\/sessions\/([^/]+)$/.exec(path);
    if (method === "DELETE" && del) {
      const id = decodeURIComponent(del[1]);
      if (!sessions.delete(id)) return sendJson(res, 404, { error: "not_found" });
      return sendJson(res, 200, {});
    }

    return sendJson(res, 404, { error: "not_found" });
  }

  return createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "server_error" });
      else res.end();
    });
  });
}

function uuidFrom(seed: string): string {
  const h = createHmac("sha256", "fake-enable-banking").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
