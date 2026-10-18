export type TransferLinkError = "sameSign" | "amountMismatch" | "sameAccount" | "split";

export interface LinkableRow {
  accountId: string;
  amountCents: number;
  /** True when the transaction has split parts: a split has no single category or side. */
  isSplit?: boolean;
}

/** Checks a hand-made link: `out` must be an outflow, `inn` an inflow of the same size, on another account. */
export function validateTransferLink(out: LinkableRow, inn: LinkableRow): TransferLinkError | null {
  if (out.isSplit || inn.isSplit) return "split";
  if (out.amountCents >= 0 || inn.amountCents <= 0) return "sameSign";
  if (-out.amountCents !== inn.amountCents) return "amountMismatch";
  if (out.accountId === inn.accountId) return "sameAccount";
  return null;
}
