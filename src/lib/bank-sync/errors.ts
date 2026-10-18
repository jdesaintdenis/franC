export type BankSyncErrorCode =
  | "not_configured"
  | "unauthorized"
  | "bank_unavailable"
  | "invalid_response"
  | "network"
  | "not_found"
  | "rate_limited";

/** Typed failure from the bank API. The message carries the code (and status) only, never a response body. */
export class BankSyncError extends Error {
  readonly code: BankSyncErrorCode;
  readonly status?: number;

  constructor(code: BankSyncErrorCode, status?: number) {
    super(status === undefined ? code : `${code} (${status})`);
    this.name = "BankSyncError";
    this.code = code;
    this.status = status;
  }
}
