import { consentValidUntil } from "./consent";
import { BankSyncError } from "./errors";
import { ibanLast4 } from "./link";

// Pending connections the user abandoned at the bank are cleared after this long.
const PENDING_TTL_MS = 60 * 60 * 1000;

/** The slice of the Enable Banking client the connect flow needs (structural, so tests can fake it). */
export interface ConnectApi {
  getAspsps(
    country: string,
  ): Promise<ReadonlyArray<{ name: string; country: string; maximum_consent_validity?: number | null }>>;
  startAuth(input: {
    aspsp: { name: string; country: string };
    validUntil: Date;
    redirectUrl: string;
    state: string;
  }): Promise<{ url: string }>;
  createSession(code: string): Promise<{
    session_id: string;
    accounts: ReadonlyArray<{
      uid: string;
      account_id?: { iban?: string | null } | null;
      name?: string | null;
      product?: string | null;
      currency?: string | null;
      identification_hash?: string | null;
    }>;
    access?: { valid_until?: string } | null;
  }>;
  deleteSession(sessionId: string): Promise<void>;
}

export interface PendingConnection {
  id: string;
  validUntil: Date;
  /** Set when this attempt is a Reconnect: the connection it takes over from. */
  replacesConnectionId?: string | null;
}

export interface NewBankAccount {
  bankAccountUid: string;
  displayName: string;
  ibanLast4: string | null;
  currency: string | null;
  identificationHash?: string | null;
}

/** Persistence the flow needs; implemented over Drizzle in `src/db/queries/bank-connections.ts`. */
export interface ConnectStore {
  deletePendingBefore(userId: string, before: Date): Promise<void>;
  createPending(
    userId: string,
    input: {
      aspspName: string;
      aspspCountry: string;
      authState: string;
      validUntil: Date;
      replacesConnectionId?: string;
    },
  ): Promise<void>;
  /** Whether the user has this (non-pending) connection: Reconnect may only replace one's own. */
  ownsConnection(userId: string, connectionId: string): Promise<boolean>;
  findPendingByState(userId: string, state: string): Promise<PendingConnection | null>;
  deletePending(userId: string, id: string): Promise<void>;
  activate(
    userId: string,
    id: string,
    input: { sessionId: string; validUntil: Date; connectedAt: Date; accounts: NewBankAccount[] },
  ): Promise<{
    /** The connection was a Reconnect and its links now carry over to the new one. */
    reconnected: boolean;
    /** Session of the replaced connection, to end at Enable Banking after the commit. */
    replacedSessionId: string | null;
  }>;
}

export type StartConnectResult = { ok: true; url: string } | { ok: false; code: "unknown_bank" | BankSyncError["code"] };

/** Creates a pending connection and asks Enable Banking for the bank's login page. */
export async function startConnect(deps: {
  api: ConnectApi;
  store: ConnectStore;
  userId: string;
  aspsp: { name: string; country: string };
  redirectUrl: string;
  state: string;
  now: Date;
  /** Reconnect: the user's connection this one replaces. */
  replacesConnectionId?: string;
}): Promise<StartConnectResult> {
  const { api, store, userId, aspsp, now } = deps;
  try {
    if (deps.replacesConnectionId && !(await store.ownsConnection(userId, deps.replacesConnectionId))) {
      return { ok: false, code: "not_found" };
    }
    const aspsps = await api.getAspsps(aspsp.country);
    const bank = aspsps.find((a) => a.name === aspsp.name && a.country === aspsp.country);
    if (!bank) return { ok: false, code: "unknown_bank" };

    const validUntil = consentValidUntil(now, bank.maximum_consent_validity ?? undefined);
    await store.deletePendingBefore(userId, new Date(now.getTime() - PENDING_TTL_MS));
    await store.createPending(userId, {
      aspspName: bank.name,
      aspspCountry: bank.country,
      authState: deps.state,
      validUntil,
      ...(deps.replacesConnectionId ? { replacesConnectionId: deps.replacesConnectionId } : {}),
    });
    const { url } = await api.startAuth({ aspsp: { name: bank.name, country: bank.country }, validUntil, redirectUrl: deps.redirectUrl, state: deps.state });
    return { ok: true, url };
  } catch (error) {
    if (error instanceof BankSyncError) return { ok: false, code: error.code };
    throw error;
  }
}

export type CompleteConnectResult =
  | { ok: true; connectionId: string; reconnected: boolean }
  | { ok: false; code: "invalid_state" | "denied" | BankSyncError["code"] };

/**
 * Handles the bank's redirect. The state must match one of *this user's* pending connections, so a
 * callback URL crafted by someone else (or replayed) can't attach a session to the wrong account.
 */
export async function completeConnect(deps: {
  api: ConnectApi;
  store: ConnectStore;
  userId: string;
  params: { code?: string; state?: string; error?: string };
  now: Date;
}): Promise<CompleteConnectResult> {
  const { api, store, userId, params, now } = deps;
  if (!params.state) return { ok: false, code: "invalid_state" };
  const pending = await store.findPendingByState(userId, params.state);
  if (!pending) return { ok: false, code: "invalid_state" };

  if (params.error || !params.code) {
    await store.deletePending(userId, pending.id);
    return { ok: false, code: "denied" };
  }

  try {
    const session = await api.createSession(params.code);
    const bankUntil = session.access?.valid_until ? new Date(session.access.valid_until) : null;
    const activated = await store.activate(userId, pending.id, {
      sessionId: session.session_id,
      validUntil: bankUntil && !Number.isNaN(bankUntil.getTime()) ? bankUntil : pending.validUntil,
      connectedAt: now,
      accounts: session.accounts.map((a) => toNewBankAccount(a)),
    });
    if (activated.replacedSessionId) {
      // After the commit and best effort: the old consent is useless now, and a failure here must not undo the reconnect.
      await api.deleteSession(activated.replacedSessionId).catch(() => undefined);
    }
    return { ok: true, connectionId: pending.id, reconnected: activated.reconnected };
  } catch (error) {
    await store.deletePending(userId, pending.id);
    if (error instanceof BankSyncError) return { ok: false, code: error.code };
    throw error;
  }
}

function toNewBankAccount(account: Awaited<ReturnType<ConnectApi["createSession"]>>["accounts"][number]): NewBankAccount {
  const last4 = ibanLast4(account.account_id?.iban);
  const displayName = account.name?.trim() || account.product?.trim() || (last4 ? `•• ${last4}` : account.uid.slice(0, 8));
  return {
    bankAccountUid: account.uid,
    displayName,
    ibanLast4: last4,
    currency: account.currency ?? null,
    identificationHash: account.identification_hash ?? null,
  };
}
