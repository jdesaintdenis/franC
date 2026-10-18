import type { ConnectionHealth } from "@/lib/bank-sync/health";
import type { LinkChoice } from "@/lib/bank-sync/link";

export interface LinkRowView {
  id: string;
  displayName: string;
  ibanLast4: string | null;
  accountName: string | null;
  /** Pre-selected in the link form: the saved choice, or the suggested one before the first save. */
  choice: LinkChoice;
  /** The name a "New account" choice would get. */
  newName: string;
  /** Balance of the franC account this link feeds; null when not imported or unknown. */
  balanceCents: number | null;
  /** Start date shown in the link form: the saved one, else the default for the chosen account. */
  syncFrom: string;
  /** Synced at least once into its current account: the start date is settled. */
  synced: boolean;
  /** "Synced 02/10/2026 10:42 · 12 new" or "Not synced yet · from 26 Sept"; null when not imported. */
  statusLabel: string | null;
  /** Slice 49 health of this link: the last attempt, its error code (null after a success) and the start of the failures. */
  lastAttemptAt: Date | null;
  lastError: string | null;
  failingSince: Date | null;
}

export interface ConnectionView {
  id: string;
  bankName: string;
  validUntilLabel: string;
  needsLinking: boolean;
  /** How the connection is doing (reconnect / failing / rate limited / ok / never); see `connectionHealth`. */
  health: ConnectionHealth;
  /** The status line under the bank name ("Synced 2 hr. ago", "Reconnect needed · ends 12 Oct", …), translated on the server. */
  statusText: string;
  /** Where Reconnect goes (the connect route with `reconnect=<id>`); null unless health asks to reconnect. */
  reconnectHref: string | null;
  links: LinkRowView[];
  /** Start date limits: 90 days of history including today. Also the default for a new account. */
  syncFromMin: string;
  syncFromMax: string;
}

export interface AccountOption {
  id: string;
  name: string;
  /** Link (of any connection) that feeds this account, if any. */
  linkId: string | null;
  /** Default start date for this account: the day after its newest transaction. */
  defaultSyncFrom: string;
}

export const CALLBACK_ERRORS = [
  "denied",
  "invalid_state",
  "unknown_bank",
  "unauthorized",
  "bank_unavailable",
  "network",
  "invalid_response",
  "not_found",
  "rate_limited",
  "not_configured",
  "unexpected",
] as const;
export type CallbackError = (typeof CALLBACK_ERRORS)[number];
