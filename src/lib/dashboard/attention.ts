import type { AccountBalanceOverview } from "../balance/projection";
import type { StaleAccount } from "../import-reminder/staleness";
import type { ForecastEntry } from "../recurring/forecast";

export interface PriceAlertInput {
  id: string;
  /** The recurring item the alert is about (the Recurring page opens its sheet). */
  recurringId: string;
  name: string;
  oldAmountCents: number;
  newAmountCents: number;
}

/** A connected account whose transactions don't add up to the bank's balances (see `findBalanceGap`). */
export interface BalanceGapInput {
  accountId: string;
  name: string;
  /** The bank's change minus franC's movement: negative = the bank shows less than franC. */
  amountCents: number;
  from: string;
  to: string;
}

/** A bank connection that needs a Reconnect: its consent ends soon, has ended, or the bank refuses the session. */
export interface BankReconnectInput {
  connectionId: string;
  bankName: string;
  /** ISO day the consent ends. */
  expiresOn: string;
  expired: boolean;
  /** "refused": consent still valid but the bank no longer accepts the session, so no date is shown. */
  reason: "expiring" | "expired" | "refused";
}

/** A bank connection whose sync has been failing since this day (ISO, Paris). */
export interface BankFailingInput {
  connectionId: string;
  bankName: string;
  since: string;
}

export interface AttentionInput {
  /** ISO day the nightly backup started failing; null/absent when it works or for users who don't own the deployment. */
  backupFailingSince?: string | null;
  staleAccounts: StaleAccount[];
  reminderDays: number | null;
  toReview: number;
  priceAlerts: PriceAlertInput[];
  balances: AccountBalanceOverview[];
  gaps: BalanceGapInput[];
  /** Optional: users without bank sync have none. */
  bankReconnects?: BankReconnectInput[];
  bankFailing?: BankFailingInput[];
  /** Rows added by hand that the bank still hasn't shown a week later (Slice 56). */
  notFound?: number;
}

export type AttentionItem =
  | { kind: "belowNow"; accountId: string; name: string; thresholdCents: number }
  | ({ kind: "bankReconnect" } & BankReconnectInput)
  | ({ kind: "bankFailing" } & BankFailingInput)
  | { kind: "backupFailing"; since: string }
  | ({ kind: "balanceGap" } & BalanceGapInput)
  | { kind: "notFound"; count: number }
  | { kind: "staleImport"; accounts: StaleAccount[]; days: number }
  | { kind: "review"; count: number }
  | { kind: "priceUp"; alert: PriceAlertInput }
  | { kind: "pricesUp"; count: number }
  | {
      kind: "lowAhead";
      accountId: string;
      name: string;
      thresholdCents: number;
      date: string;
      balanceCents: number;
      cause: { name: string; amountCents: number; status: ForecastEntry["status"] } | null;
    };

// Up to this many items are named one by one; more than that collapse into a single count line.
const MAX_LISTED = 2;

function grouped<T>(
  items: T[],
  single: (item: T) => AttentionItem,
  many: (count: number) => AttentionItem,
): AttentionItem[] {
  if (items.length === 0) return [];
  return items.length <= MAX_LISTED ? items.map(single) : [many(items.length)];
}

/**
 * What needs the user's attention, most urgent first. Codes and params only; the UI words them.
 * Budget overruns are left out: Home's budget gauges already show them (SPEC §82).
 */
export function buildAttention(input: AttentionInput): AttentionItem[] {
  const { staleAccounts, reminderDays, toReview, priceAlerts, balances, gaps } = input;
  const out: AttentionItem[] = [];

  for (const b of balances) {
    if (b.breach?.alreadyBelow) {
      out.push({ kind: "belowNow", accountId: b.accountId, name: b.name, thresholdCents: b.thresholdCents });
    }
  }
  // Without a working connection nothing else here is fresh, so it comes right after the alerts.
  for (const r of input.bankReconnects ?? []) out.push({ kind: "bankReconnect", ...r });
  for (const f of input.bankFailing ?? []) out.push({ kind: "bankFailing", ...f });
  if (input.backupFailingSince) out.push({ kind: "backupFailing", since: input.backupFailingSince });
  // The bank's own figure says franC is missing something: worth acting on before the import reminder.
  for (const gap of gaps) out.push({ kind: "balanceGap", ...gap });
  if ((input.notFound ?? 0) > 0) out.push({ kind: "notFound", count: input.notFound ?? 0 });
  if (staleAccounts.length > 0 && reminderDays !== null) {
    out.push({ kind: "staleImport", accounts: staleAccounts, days: reminderDays });
  }
  if (toReview > 0) out.push({ kind: "review", count: toReview });

  out.push(
    ...grouped(
      priceAlerts,
      (alert) => ({ kind: "priceUp", alert }),
      (count) => ({ kind: "pricesUp", count }),
    ),
  );

  for (const b of balances) {
    const breach = b.breach;
    if (!breach || breach.alreadyBelow) continue;
    out.push({
      kind: "lowAhead",
      accountId: b.accountId,
      name: b.name,
      thresholdCents: b.thresholdCents,
      date: breach.date,
      balanceCents: breach.balanceCents,
      cause: breach.cause
        ? { name: breach.cause.name, amountCents: breach.cause.amountCents, status: breach.cause.status }
        : null,
    });
  }
  return out;
}
