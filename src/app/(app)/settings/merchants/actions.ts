"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import {
  addMerchantPattern,
  countPatternMatches,
  createMerchant,
  deleteMerchant,
  removeMerchantPattern,
  restoreMerchant,
  type MerchantSnapshot,
  renameMerchant,
  type MerchantWriteError,
} from "@/db/queries/merchants";
import { withActionErrorState } from "@/lib/actions/safe-action";
import { refreshRecurringAfterMerchantChange } from "@/lib/actions/refresh-derived";
import { requireUser } from "@/lib/auth/session";
import { merchantInputErrorCode, merchantWriteErrorCode, type MerchantErrorCode } from "@/lib/merchants/error-codes";
import {
  addPatternSchema,
  createMerchantSchema,
  merchantSnapshotSchema,
  patternPreviewSchema,
  renameMerchantSchema,
} from "@/lib/merchants/input";
import { z } from "zod";

/** Codes, not copy: the client translates them (`merchant.errors.*`). */
export type MerchantActionResult =
  | {
      status: "ok";
      rowsRenamed: number;
      rowsCategorized: number;
      created?: boolean;
      /** Set by create: what Undo removes (the pattern, and the merchant when it was new). */
      merchantId?: string;
      patternId?: string;
      /** Set by delete: what Undo sends back to `restoreMerchantAction`. */
      snapshot?: MerchantSnapshot;
    }
  | { status: "error"; error: MerchantErrorCode };

const FAILED: MerchantActionResult = { status: "error", error: "saveFailed" };

function invalid(issues: readonly { message: string }[]): MerchantActionResult {
  return { status: "error", error: merchantInputErrorCode(issues) };
}

function writeError(error: MerchantWriteError): MerchantActionResult {
  return { status: "error", error: merchantWriteErrorCode(error) };
}

/** Every page that shows merchant names, counts or recurring items. */
function revalidateDependents() {
  revalidatePath("/transactions");
  revalidatePath("/settings/merchants");
  revalidatePath("/recurring");
  revalidatePath("/");
}

/** After commit: recurring items follow the new names (skipped for a pure rename). */
async function finish(
  userId: string,
  effects: { rowsRenamed: number; rowsCategorized: number },
  created?: boolean,
  ids?: { merchantId: string; patternId: string },
) {
  await refreshRecurringAfterMerchantChange(userId);
  revalidateDependents();
  return { status: "ok", rowsRenamed: effects.rowsRenamed, rowsCategorized: effects.rowsCategorized, created, ...ids } as const;
}

export async function createMerchantAction(input: unknown): Promise<MerchantActionResult> {
  return withActionErrorState("Merchant create failed", async () => {
    const user = await requireUser();
    const parsed = createMerchantSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const result = await createMerchant(db, user.id, parsed.data);
    if (!result.ok) return writeError(result.error);
    return finish(user.id, result, result.created, { merchantId: result.merchant.id, patternId: result.patternId });
  }, FAILED);
}

export async function renameMerchantAction(input: unknown): Promise<MerchantActionResult> {
  return withActionErrorState("Merchant rename failed", async () => {
    const user = await requireUser();
    const parsed = renameMerchantSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const result = await renameMerchant(db, user.id, parsed.data.merchantId, parsed.data.name);
    if (!result.ok) return writeError(result.error);
    // A rename keeps every row's merchant id, so recurring items need no refresh.
    revalidateDependents();
    return { status: "ok", rowsRenamed: result.rowsRenamed, rowsCategorized: result.rowsCategorized } as const;
  }, FAILED);
}

export async function addPatternAction(input: unknown): Promise<MerchantActionResult> {
  return withActionErrorState("Merchant pattern add failed", async () => {
    const user = await requireUser();
    const parsed = addPatternSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const { merchantId, matchType, pattern } = parsed.data;
    const result = await addMerchantPattern(db, user.id, merchantId, { matchType, pattern });
    if (!result.ok) return writeError(result.error);
    return finish(user.id, result);
  }, FAILED);
}

export async function removePatternAction(patternId: unknown): Promise<MerchantActionResult> {
  return withActionErrorState("Merchant pattern remove failed", async () => {
    const user = await requireUser();
    const id = z.uuid().safeParse(patternId);
    if (!id.success) return invalid(id.error.issues);
    const result = await removeMerchantPattern(db, user.id, id.data);
    if (!result.ok) return writeError(result.error);
    return finish(user.id, result);
  }, FAILED);
}

export async function deleteMerchantAction(merchantId: unknown): Promise<MerchantActionResult> {
  return withActionErrorState("Merchant delete failed", async () => {
    const user = await requireUser();
    const id = z.uuid().safeParse(merchantId);
    if (!id.success) return invalid(id.error.issues);
    const result = await deleteMerchant(db, user.id, id.data);
    if (!result.ok) return writeError(result.error);
    return { ...(await finish(user.id, result)), snapshot: result.snapshot };
  }, FAILED);
}

export async function restoreMerchantAction(snapshot: unknown): Promise<MerchantActionResult> {
  return withActionErrorState("Merchant restore failed", async () => {
    const user = await requireUser();
    const parsed = merchantSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) return invalid(parsed.error.issues);
    const result = await restoreMerchant(db, user.id, parsed.data);
    if (!result.ok) return writeError(result.error);
    return finish(user.id, result);
  }, FAILED);
}

/** Live "Renames N transactions" line of the row dialog; `count` is null for an unusable pattern. */
export async function previewPatternMatchesAction(
  input: unknown,
): Promise<{ status: "ok"; count: number | null } | { status: "error" }> {
  return withActionErrorState("Merchant preview failed", async () => {
    const user = await requireUser();
    const parsed = patternPreviewSchema.safeParse(input);
    if (!parsed.success) return { status: "ok", count: null } as const;
    return { status: "ok", count: await countPatternMatches(db, user.id, parsed.data.matchType, parsed.data.pattern) } as const;
  }, { status: "error" } as const);
}
