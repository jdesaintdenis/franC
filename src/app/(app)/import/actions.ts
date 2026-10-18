"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";

import { db } from "@/db/client";
import { getOwnedAccount } from "@/db/queries/accounts";
import { commitImport, importDateRange, planMatches, undoImport } from "@/db/queries/imports";
import { getWelcomeFacts } from "@/db/queries/welcome";
import { loadBankPlanContext } from "@/db/queries/bank-categories";
import { listCategoryOptions } from "@/db/queries/categories";
import { loadMerchantLookup, type MerchantLookup } from "@/db/queries/merchants";
import { resolveMerchant } from "@/lib/merchants/match";
import {
  buildImportPlan,
  cashFlows,
  dateRangeOf,
  decodeUpload,
  prepareImport,
  sampleRows,
  type KeyedTransaction,
  type RowError,
} from "@/lib/import";
import { buildBankCategoryWrites, planBankCategories, type BankPlan } from "@/lib/categorize/bank";
import { parseBankDecisions } from "@/lib/categorize/bank-decisions";
import { requireUser } from "@/lib/auth/session";
import { refreshDerivedData } from "@/lib/actions/refresh-derived";
import { withActionErrorState } from "@/lib/actions/safe-action";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ERRORS_RETURNED = 50;
const PREVIEW_SAMPLE_SIZE = 50;
const MAX_FILENAME_LENGTH = 255;

/**
 * Failures are returned as codes and translated in the client, keeping the
 * actions free of copy (and `withActionErrorState` logs a fixed English line).
 */
// Not exported: a "use server" module may only export async functions and types.
const IMPORT_ERROR_CODES = [
  "chooseFile",
  "fileEmpty",
  "notCsv",
  "fileTooLarge",
  "invalidUpload",
  "accountNotFound",
  "unrecognizedHeader",
  "previewFailed",
  "importFailed",
  "importNotFound",
  "bankCategoryNotFound",
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

function isImportErrorCode(value: unknown): value is ImportErrorCode {
  return (IMPORT_ERROR_CODES as readonly unknown[]).includes(value);
}

export interface PreviewRow {
  line: number;
  date: string;
  amountCents: number;
  label: string;
}

export type PreviewState =
  | {
      status: "preview";
      filename: string;
      accountId: string;
      /** Target account's name (user data, shown as is). */
      accountName: string;
      counts: { total: number; new: number; duplicate: number; possible: number; error: number };
      sample: PreviewRow[];
      /** Earliest and latest date of the new rows (null when there are none). */
      dateRange: { from: string; to: string } | null;
      /** Money in, out and net of the new rows. */
      flows: { inCents: number; outCents: number; netCents: number };
      errors: RowError[];
      /** Errors beyond the capped `errors` list. */
      errorsOmitted: number;
      /** Bank categories without a stored mapping (from all valid rows, duplicates included). */
      bankPlan: BankPlan;
      /** The user's categories in tree order, for the "Map to" picker. */
      categoryOptions: { id: string; label: string }[];
    }
  | { status: "error"; error: ImportErrorCode }
  | undefined;

export type ConfirmState =
  | {
      status: "done";
      /** The import just recorded, for the bulk review that follows. */
      importId: string;
      /** A new user's first import: no transaction before it and the welcome checklist not finished. */
      firstImport: boolean;
      /** Dates of the rows this import added (null when it added none). */
      dateRange: { from: string; to: string } | null;
      inserted: number;
      duplicate: number;
      error: number;
      total: number;
      /** Existing transactions that got their bank category from this file. */
      backfilled: number;
      /** New rows whose category was guessed from past choices. */
      guessed: number;
      /** New internal transfer pairs found across all accounts after this import (0 if detection failed). */
      transfersFound: number;
      /** Recurring price alerts newly raised by this import (0 if detection failed). */
      priceAlerts: number;
    }
  | { status: "error"; error: ImportErrorCode }
  | undefined;

export type UndoState = { status: "done"; deleted: number } | { status: "error"; error: ImportErrorCode };

const uploadSchema = z.object({
  accountId: z.uuid(),
  file: z
    .instanceof(File, { error: "chooseFile" })
    .refine((f) => f.size > 0, "fileEmpty")
    .refine((f) => f.name.toLowerCase().endsWith(".csv"), "notCsv")
    .refine((f) => f.size <= MAX_FILE_BYTES, "fileTooLarge"),
});

type Prepared =
  | {
      ok: true;
      userId: string;
      accountId: string;
      accountName: string;
      filename: string;
      prepared: Extract<ReturnType<typeof prepareImport>, { ok: true }>;
    }
  | { ok: false; error: ImportErrorCode };

// Both actions re-validate and re-parse the upload: the client keeps the File
// and nothing is staged server-side, so confirm never trusts the preview.
async function loadUpload(formData: FormData): Promise<Prepared> {
  const user = await requireUser();

  const parsed = uploadSchema.safeParse({
    accountId: formData.get("accountId"),
    file: formData.get("file"),
  });
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { ok: false, error: isImportErrorCode(message) ? message : "invalidUpload" };
  }
  const { accountId, file } = parsed.data;

  const account = await getOwnedAccount(user.id, accountId);
  // A Savings account takes no imports: it is filled by "Move to savings".
  if (!account || account.savings) return { ok: false, error: "accountNotFound" };

  const prepared = prepareImport(decodeUpload(await file.arrayBuffer()), account.id);
  if (!prepared.ok) return { ok: false, error: prepared.fileError };

  return {
    ok: true,
    userId: user.id,
    accountId: account.id,
    accountName: account.name,
    filename: file.name.trim().slice(0, MAX_FILENAME_LENGTH),
    prepared,
  };
}

/** A known merchant shows by name, so the preview looks like the list will. */
function toPreviewRow(t: KeyedTransaction, merchants: MerchantLookup): PreviewRow {
  const bankLabel = t.labelSimplified || t.labelRaw;
  const merchantId = resolveMerchant(merchants.patterns, { normalized: t.labelNormalized, display: bankLabel });
  return {
    line: t.line,
    date: t.date,
    amountCents: t.amountCents,
    label: (merchantId !== null ? merchants.names.get(merchantId) : undefined) ?? bankLabel,
  };
}

export async function previewImport(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  return withActionErrorState(
    "Could not read the file. Try again.",
    () => previewImportImpl(formData),
    { status: "error", error: "previewFailed" },
  );
}

async function previewImportImpl(formData: FormData): Promise<PreviewState> {
  const upload = await loadUpload(formData);
  if (!upload.ok) return { status: "error", error: upload.error };
  const { userId, accountId, accountName, filename, prepared } = upload;

  // Same verdicts as the commit, so rows a bank sync already brought in count as duplicates here too.
  const { decisions } = await planMatches(db, userId, accountId, "csv", prepared.transactions);
  const plan = buildImportPlan(prepared, decisions);

  const [context, options] = await Promise.all([
    loadBankPlanContext(db, userId),
    listCategoryOptions(userId, await getLocale()),
  ]);
  const merchantLookup = await loadMerchantLookup(db, userId);
  const bankPlan = planBankCategories(prepared.transactions, context.mappings, context.categories);

  return {
    status: "preview",
    filename,
    accountId,
    accountName,
    counts: plan.counts,
    sample: sampleRows(plan.fresh, PREVIEW_SAMPLE_SIZE).map((t) => toPreviewRow(t, merchantLookup)),
    dateRange: dateRangeOf(plan.fresh),
    flows: cashFlows(plan.fresh),
    errors: plan.errors.slice(0, MAX_ERRORS_RETURNED),
    errorsOmitted: Math.max(0, plan.errors.length - MAX_ERRORS_RETURNED),
    bankPlan,
    categoryOptions: options.map((o) => ({ id: o.id, label: o.label })),
  };
}

export async function confirmImport(_prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  return withActionErrorState(
    "Could not import the file. Nothing was saved; try again.",
    () => confirmImportImpl(formData),
    { status: "error", error: "importFailed" },
  );
}

async function confirmImportImpl(formData: FormData): Promise<ConfirmState> {
  const upload = await loadUpload(formData);
  if (!upload.ok) return { status: "error", error: upload.error };
  const { userId, accountId, filename, prepared } = upload;

  // A malformed decisions field is rejected rather than ignored: silently
  // dropping the user's choices would import rows uncategorized.
  const decisions = parseBankDecisions(formData.get("bankDecisions"));
  if (decisions === null) return { status: "error", error: "invalidUpload" };

  // The plan is re-derived from the file and the current mappings, never taken from the client.
  const context = await loadBankPlanContext(db, userId);
  const bankPlan = planBankCategories(prepared.transactions, context.mappings, context.categories);
  const built = buildBankCategoryWrites(bankPlan, decisions, context.categories);
  if (!built.ok) return { status: "error", error: "bankCategoryNotFound" };

  // Read before the commit: afterwards the import's own rows would count. Someone who
  // undid every import but already finished the welcome checklist isn't new.
  const welcome = await getWelcomeFacts(db, userId);
  const firstImport = !welcome.hasTransactions && !welcome.completed;

  // All valid rows go in, not just the ones the preview saw as new: the DB
  // unique constraint decides what is really a duplicate.
  const { import: result, rowsBackfilled, rowsGuessed } = await commitImport(db, {
    userId,
    accountId,
    filename,
    rowsTotal: prepared.rowsTotal,
    rowsError: prepared.errors.length,
    transactions: prepared.transactions,
    bankWrites: built.writes,
  });

  const dateRange = await importDateRange(db, userId, result.id);

  // Even when nothing was inserted: re-importing a file is how existing data gets scanned.
  const { transfersFound, priceAlerts } = await refreshDerivedData(userId, "import");

  revalidatePath("/import");
  revalidatePath("/transactions");
  revalidatePath("/recurring");
  revalidatePath("/");
  return {
    status: "done",
    importId: result.id,
    firstImport,
    dateRange,
    inserted: result.rowsInserted,
    duplicate: result.rowsDuplicate,
    error: result.rowsError,
    total: result.rowsTotal,
    backfilled: rowsBackfilled,
    guessed: rowsGuessed,
    transfersFound,
    priceAlerts,
  };
}

export async function undoImportAction(importId: string): Promise<UndoState> {
  const user = await requireUser();

  const parsed = z.uuid().safeParse(importId);
  if (!parsed.success) return { status: "error", error: "importNotFound" };

  const result = await undoImport(db, user.id, parsed.data);
  if (!result) return { status: "error", error: "importNotFound" };

  await refreshDerivedData(user.id, "import");

  revalidatePath("/import");
  revalidatePath("/transactions");
  revalidatePath("/recurring");
  revalidatePath("/");
  return { status: "done", deleted: result.deleted };
}
