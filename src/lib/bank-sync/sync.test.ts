import { describe, expect, it } from "vitest";

import type { EnableBankingClient, GetTransactionsInput } from "./client";
import { BankSyncError } from "./errors";
import type { BankBalance, BankTransaction } from "./schemas";
import { syncAccount, type SyncCommitInput, type SyncLink, type SyncStore } from "./sync";

const NOW = new Date("2026-10-02T10:00:00Z");

const tx = (over: Partial<BankTransaction>): BankTransaction => ({
  entry_reference: "E1",
  transaction_amount: { amount: "5.88", currency: "EUR" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2026-10-01",
  remittance_information: ["CB BOULANGERIE DES L FACT 300926 4000XXXX1234"],
  ...over,
});

function setup(opts: {
  link?: Partial<SyncLink> | null;
  transactions?: BankTransaction[] | Error;
  balances?: BankBalance[] | Error;
  newest?: string | null;
  /** What the store's commit reports as already known (the matcher runs there). */
  known?: number;
}) {
  const calls: { fetch: GetTransactionsInput[]; commits: SyncCommitInput[]; marked: unknown[] } = {
    fetch: [],
    commits: [],
    marked: [],
  };
  const client = {
    async getTransactions(_uid: string, input: GetTransactionsInput) {
      calls.fetch.push(input);
      if (opts.transactions instanceof Error) throw opts.transactions;
      return opts.transactions ?? [];
    },
    async getBalances() {
      if (opts.balances instanceof Error) throw opts.balances;
      return opts.balances ?? [];
    },
  } as unknown as EnableBankingClient;
  const store: SyncStore = {
    async findLink() {
      if (opts.link === null) return null;
      return { accountId: "acc", bankAccountUid: "uid", bankName: "Caisse d'Epargne", syncFrom: null, lastSyncedAt: null, ...opts.link };
    },
    async newestTransactionDate() {
      return opts.newest ?? null;
    },
    async csvLabels() {
      return [{ labelRaw: "CB BOULANGERIE DES L FACT 010926", labelSimplified: "BOULANGERIE DES LILAS", date: "2026-09-01" }];
    },
    async commit(input) {
      calls.commits.push(input);
      const duplicate = opts.known ?? 0;
      return { importId: "imp", inserted: input.rows.length - duplicate, duplicate, possible: 0 };
    },
    async markSynced(_userId, _linkId, input) {
      calls.marked.push(input);
    },
  };
  return { calls, run: () => syncAccount({ client, store, now: NOW }, "user", "link") };
}

describe("syncAccount", () => {
  it("converts booked rows and commits them as a sync run", async () => {
    const { calls, run } = setup({ newest: "2026-09-25", transactions: [tx({})] });
    const result = await run();
    expect(result).toEqual({ ok: true, importId: "imp", inserted: 1, duplicate: 0, possible: 0, errors: 0 });
    // The day after the newest transaction, minus the 4-day overlap.
    expect(calls.fetch[0]).toMatchObject({ dateFrom: "2026-09-22", status: "BOOK" });
    const [commit] = calls.commits;
    expect(commit).toMatchObject({ accountId: "acc", filename: "Caisse d'Epargne", rowsTotal: 1, rowsError: 0 });
    expect(commit.rows[0]).toMatchObject({
      date: "2026-09-30",
      amountCents: -588,
      labelRaw: "CB BOULANGERIE DES L FACT 300926",
      labelSimplified: "BOULANGERIE DES LILAS",
      externalId: "E1",
      occurrenceIndex: 0,
    });
    expect(commit.rows[0].dedupeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(calls.marked).toEqual([{ at: NOW, syncFrom: "2026-09-26" }]);
  });

  it("re-reads the last week on later syncs", async () => {
    const { calls, run } = setup({
      link: { syncFrom: "2026-08-01", lastSyncedAt: new Date("2026-09-30T08:00:00Z") },
    });
    await run();
    expect(calls.fetch[0].dateFrom).toBe("2026-09-19");
    expect(calls.marked).toEqual([{ at: NOW, syncFrom: "2026-08-01" }]);
  });

  it("reports the commit's duplicate count and sends every converted row, overlap included", async () => {
    const { calls, run } = setup({
      link: { syncFrom: "2026-10-01" },
      transactions: [tx({ entry_reference: "A" }), tx({ entry_reference: "B", remittance_information: ["PRLV ORANGE"] })],
      known: 1,
    });
    const result = await run();
    expect(calls.commits[0].rows.map((r) => r.externalId)).toEqual(["A", "B"]);
    expect(result).toMatchObject({ ok: true, inserted: 1, duplicate: 1 });
  });

  it("reports unreadable rows without dropping them silently", async () => {
    const { calls, run } = setup({ transactions: [tx({ transaction_amount: { amount: "1.00", currency: "USD" } })] });
    expect(await run()).toMatchObject({ ok: true, inserted: 0, errors: 1 });
    expect(calls.commits[0]).toMatchObject({ rowsTotal: 1, rowsError: 1, rows: [] });
  });

  it("commits even when nothing is new, so every run is in the history", async () => {
    const { calls, run } = setup({ transactions: [] });
    expect(await run()).toMatchObject({ ok: true, inserted: 0 });
    expect(calls.commits).toHaveLength(1);
  });

  it("turns a bank failure into its code and commits nothing", async () => {
    const { calls, run } = setup({ transactions: new BankSyncError("unauthorized", 401) });
    expect(await run()).toEqual({ ok: false, error: "unauthorized" });
    expect(calls.commits).toHaveLength(0);
    expect(calls.marked).toHaveLength(0);
  });

  it("refuses a link that isn't the user's or isn't linked", async () => {
    const { calls, run } = setup({ link: null });
    expect(await run()).toEqual({ ok: false, error: "linkNotFound" });
    expect(calls.fetch).toHaveLength(0);
  });

  it("saves the bank's booked balance with the rows", async () => {
    const { calls, run } = setup({
      transactions: [tx({})],
      balances: [
        { balance_type: "XPCD", balance_amount: { amount: "1.00", currency: "EUR" } },
        { balance_type: "CLBD", balance_amount: { amount: "1234.56", currency: "EUR" }, reference_date: "2026-10-02" },
      ],
    });
    expect(await run()).toMatchObject({ ok: true });
    expect(calls.commits[0].balance).toEqual({
      date: "2026-10-02",
      amountCents: 123456,
      balanceType: "CLBD",
      bankName: "Caisse d'Epargne",
      fetchedAt: NOW,
    });
  });

  it("commits without a checkpoint when the bank sends no usable balance", async () => {
    const { calls, run } = setup({ transactions: [tx({})], balances: [] });
    expect(await run()).toMatchObject({ ok: true });
    expect(calls.commits[0].balance).toBeNull();
  });

  it("still succeeds, without a checkpoint, when only the balance call fails", async () => {
    const { calls, run } = setup({ transactions: [tx({})], balances: new BankSyncError("bank_unavailable", 500) });
    expect(await run()).toMatchObject({ ok: true, inserted: 1 });
    expect(calls.commits[0].balance).toBeNull();
    expect(calls.marked).toHaveLength(1);
  });
});
