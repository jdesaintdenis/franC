"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { db } from "@/db/client";
import {
  addTagsToTransaction,
  bulkAddTag as bulkAddTagQuery,
  bulkRemoveTag as bulkRemoveTagQuery,
  MAX_BULK_TAG_IDS,
  removeTagFromTransaction,
  setTransactionNote,
  type TagRef,
} from "@/db/queries/tags";
import { requireUser } from "@/lib/auth/session";
import { normalizeNote, normalizeTagName, parseTagList, type TagNameError } from "@/lib/tags/validate";

/** Codes, not copy: the dialog and bulk bar translate them (`transactions.tags.errors.*`, `transactions.note.errors.*`). */
export type TagsErrorCode =
  | TagNameError
  | "tooManyTags"
  | "tooManyUserTags"
  | "tooManyRows"
  | "notFound"
  | "invalidInput"
  | "saveFailed";

export type SaveNoteResult =
  | { status: "done"; note: string | null }
  | { status: "error"; error: "tooLong" | "notFound" | "invalidInput" | "saveFailed" };
export type AddTagsResult = { status: "done"; tags: TagRef[] } | { status: "error"; error: TagsErrorCode };
export type RemoveTagResult = { status: "done" } | { status: "error"; error: TagsErrorCode };
export type BulkAddTagResult =
  | { status: "done"; updated: number; skipped: number; tag: TagRef | null }
  | { status: "error"; error: TagsErrorCode };
export type BulkRemoveTagResult = { status: "done"; updated: number } | { status: "error"; error: TagsErrorCode };

/**
 * Notes and tag names are user text and Drizzle errors embed bound parameters, so unexpected
 * failures are swallowed into a code here and never logged.
 */
async function guarded<T, E>(fn: () => Promise<T>, failed: E): Promise<T | E> {
  try {
    return await fn();
  } catch (error) {
    unstable_rethrow(error);
    return failed;
  }
}

function revalidateTagged(): void {
  // Row chips, the tag filter and its total, and the counts in Settings > Tags.
  revalidatePath("/transactions");
  revalidatePath("/settings/tags");
  // The review dialog suggests tag names from the page props.
  revalidatePath("/review");
}

const idSchema = z.uuid();
const noteInput = z.object({ transactionId: idSchema, note: z.string().max(5000) });
const addTagsInput = z.object({ transactionId: idSchema, input: z.string().max(1000) });
const removeTagInput = z.object({ transactionId: idSchema, tagId: idSchema });
const bulkIds = z
  .array(idSchema)
  .min(1)
  .max(MAX_BULK_TAG_IDS)
  .transform((ids) => [...new Set(ids)]);
const bulkAddInput = z.object({ transactionIds: bulkIds, name: z.string().max(1000) });
const bulkRemoveInput = z.object({ transactionIds: bulkIds, tagId: idSchema });

/** Sets or clears (empty text) a transaction's note. */
export async function saveNote(input: unknown): Promise<SaveNoteResult> {
  const user = await requireUser();
  const parsed = noteInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };
  const normalized = normalizeNote(parsed.data.note);
  if (!normalized.ok) return { status: "error", error: normalized.code };

  return guarded<SaveNoteResult, SaveNoteResult>(
    async () => {
      const saved = await setTransactionNote(db, user.id, parsed.data.transactionId, normalized.note);
      if (!saved) return { status: "error", error: "notFound" };
      revalidateTagged();
      return { status: "done", note: normalized.note };
    },
    { status: "error", error: "saveFailed" },
  );
}

/** Adds one or several comma-separated tags to a transaction, creating the new ones. */
export async function addTags(input: unknown): Promise<AddTagsResult> {
  const user = await requireUser();
  const parsed = addTagsInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };
  const { names, errors } = parseTagList(parsed.data.input);
  // A partly valid list is refused as a whole rather than silently dropping an entry.
  if (errors.length > 0) return { status: "error", error: errors[0] };
  if (names.length === 0) return { status: "error", error: "empty" };

  return guarded<AddTagsResult, AddTagsResult>(
    async () => {
      const result = await addTagsToTransaction(db, user.id, parsed.data.transactionId, names);
      if (!result.ok) return { status: "error", error: result.code };
      revalidateTagged();
      return { status: "done", tags: result.tags };
    },
    { status: "error", error: "saveFailed" },
  );
}

/** Removes one tag from one transaction. The tag itself stays. */
export async function removeTag(input: unknown): Promise<RemoveTagResult> {
  const user = await requireUser();
  const parsed = removeTagInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  return guarded<RemoveTagResult, RemoveTagResult>(
    async () => {
      await removeTagFromTransaction(db, user.id, parsed.data.transactionId, parsed.data.tagId);
      revalidateTagged();
      return { status: "done" };
    },
    { status: "error", error: "saveFailed" },
  );
}

/** Adds one tag (created or reused by name) to many transactions. */
export async function bulkAddTag(input: unknown): Promise<BulkAddTagResult> {
  const user = await requireUser();
  const parsed = bulkAddInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };
  const name = normalizeTagName(parsed.data.name);
  if (!name.ok) return { status: "error", error: name.code };

  return guarded<BulkAddTagResult, BulkAddTagResult>(
    async () => {
      const result = await bulkAddTagQuery(db, user.id, parsed.data.transactionIds, name.name);
      if (!result.ok) return { status: "error", error: result.code };
      revalidateTagged();
      return { status: "done", updated: result.updated, skipped: result.skipped, tag: result.tag };
    },
    { status: "error", error: "saveFailed" },
  );
}

/** Removes one tag from many transactions. */
export async function bulkRemoveTag(input: unknown): Promise<BulkRemoveTagResult> {
  const user = await requireUser();
  const parsed = bulkRemoveInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  return guarded<BulkRemoveTagResult, BulkRemoveTagResult>(
    async () => {
      const result = await bulkRemoveTagQuery(db, user.id, parsed.data.transactionIds, parsed.data.tagId);
      revalidateTagged();
      return { status: "done", updated: result.updated };
    },
    { status: "error", error: "saveFailed" },
  );
}
