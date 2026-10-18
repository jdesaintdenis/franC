import { z } from "zod";
import type { EnableBankingConfig } from "./config";
import { BankSyncError } from "./errors";
import { signEnableBankingJwt } from "./jwt";
import {
  aspspsResponseSchema,
  authResponseSchema,
  balancesResponseSchema,
  sessionResponseSchema,
  transactionsResponseSchema,
  type Aspsp,
  type BankBalance,
  type BankTransaction,
  type SessionResponse,
} from "./schemas";

export type StartAuthInput = {
  aspsp: { name: string; country: string };
  validUntil: Date;
  redirectUrl: string;
  state: string;
};

/** Who is in front of the screen. Sent on a sync the user started, so the bank counts it as attended. */
export type PsuContext = { ipAddress: string; userAgent: string };

export type GetTransactionsInput = {
  /** ISO `YYYY-MM-DD`, inclusive. */
  dateFrom: string;
  /** Only `BOOK` is wanted for import; omitted, the bank sends every status. */
  status?: "BOOK";
  psu?: PsuContext;
};

export type EnableBankingClient = {
  getAspsps(country: string): Promise<Aspsp[]>;
  startAuth(input: StartAuthInput): Promise<{ url: string }>;
  createSession(code: string): Promise<SessionResponse>;
  deleteSession(sessionId: string): Promise<void>;
  getTransactions(accountUid: string, input: GetTransactionsInput): Promise<BankTransaction[]>;
  getBalances(accountUid: string, input?: { psu?: PsuContext }): Promise<BankBalance[]>;
};

const TIMEOUT_MS = 15_000;
// A runaway continuation key must not loop forever; 50 pages is far beyond 90 days of a personal account.
const MAX_PAGES = 50;

function psuHeaders(psu: PsuContext | undefined): Record<string, string> {
  return psu ? { "Psu-Ip-Address": psu.ipAddress, "Psu-User-Agent": psu.userAgent } : {};
}

const rateLimitBodySchema = z.looseObject({ error: z.literal("ASPSP_RATE_LIMIT_EXCEEDED") });

/** The bank's daily limit, as opposed to any other 429. The body is only inspected, never kept or logged. */
async function isRateLimitBody(res: Response): Promise<boolean> {
  try {
    return rateLimitBodySchema.safeParse(await res.json()).success;
  } catch {
    return false;
  }
}

export function createEnableBankingClient(
  config: EnableBankingConfig,
  opts: { fetch?: typeof fetch; now?: () => Date } = {},
): EnableBankingClient {
  const fetchFn = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());

  async function request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      ...extraHeaders,
      Authorization: `Bearer ${signEnableBankingJwt(config, now())}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetchFn(`${config.apiOrigin}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new BankSyncError("network");
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new BankSyncError("unauthorized", res.status);
      if (res.status === 404) throw new BankSyncError("not_found", res.status);
      if (res.status === 429 && (await isRateLimitBody(res))) throw new BankSyncError("rate_limited", res.status);
      throw new BankSyncError("bank_unavailable", res.status);
    }
    return res;
  }

  async function requestJson<S extends z.ZodType>(
    schema: S,
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<z.output<S>> {
    const res = await request(method, path, body, extraHeaders);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new BankSyncError("invalid_response", res.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new BankSyncError("invalid_response", res.status);
    return parsed.data;
  }

  return {
    async getAspsps(country) {
      const query = new URLSearchParams({ country, psu_type: "personal" });
      const data = await requestJson(aspspsResponseSchema, "GET", `/aspsps?${query}`);
      return data.aspsps;
    },
    async startAuth({ aspsp, validUntil, redirectUrl, state }) {
      const data = await requestJson(authResponseSchema, "POST", "/auth", {
        access: { valid_until: validUntil.toISOString() },
        aspsp,
        state,
        redirect_url: redirectUrl,
        psu_type: "personal",
      });
      return { url: data.url };
    },
    createSession(code) {
      return requestJson(sessionResponseSchema, "POST", "/sessions", { code });
    },
    async deleteSession(sessionId) {
      try {
        await request("DELETE", `/sessions/${encodeURIComponent(sessionId)}`);
      } catch (err) {
        // Already gone on the bank side is the outcome we wanted.
        if (err instanceof BankSyncError && err.code === "not_found") return;
        throw err;
      }
    },
    async getBalances(accountUid, { psu } = {}) {
      const path = `/accounts/${encodeURIComponent(accountUid)}/balances`;
      const data = await requestJson(balancesResponseSchema, "GET", path, undefined, psuHeaders(psu));
      return data.balances;
    },
    async getTransactions(accountUid, { dateFrom, status, psu }) {
      const headers = psuHeaders(psu);
      const path = `/accounts/${encodeURIComponent(accountUid)}/transactions`;
      const out: BankTransaction[] = [];
      let continuationKey: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({ date_from: dateFrom });
        if (status) query.set("transaction_status", status);
        if (continuationKey) query.set("continuation_key", continuationKey);
        const data = await requestJson(transactionsResponseSchema, "GET", `${path}?${query}`, undefined, headers);
        out.push(...data.transactions);
        continuationKey = data.continuation_key || null;
        if (!continuationKey) return out;
      }
      throw new BankSyncError("invalid_response");
    },
  };
}
