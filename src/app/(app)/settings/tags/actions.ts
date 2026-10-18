"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db/client";
import { deleteTag, renameTag, restoreTag, type TagSnapshot } from "@/db/queries/tags";
import { withActionErrorState } from "@/lib/actions/safe-action";
import { requireUser } from "@/lib/auth/session";
import { normalizeTagName, type TagNameError } from "@/lib/tags/validate";

/** Codes, not copy: the client translates them (`settings.tags.errors.*`). */
export type TagError = TagNameError | "conflict" | "notFound" | "invalidInput" | "saveFailed";
export type TagActionResult = { status: "ok"; name?: string } | { status: "error"; error: TagError };

const FAILED = { status: "error", error: "saveFailed" } as const;

const renameInput = z.object({ tagId: z.uuid(), name: z.string().max(500) });

function revalidateDependents() {
  revalidatePath("/settings/tags");
  revalidatePath("/transactions");
  revalidatePath("/review");
}

export async function renameTagAction(input: unknown): Promise<TagActionResult> {
  return withActionErrorState("Tag rename failed", async (): Promise<TagActionResult> => {
    const user = await requireUser();
    const parsed = renameInput.safeParse(input);
    if (!parsed.success) return { status: "error", error: "invalidInput" };
    const name = normalizeTagName(parsed.data.name);
    if (!name.ok) return { status: "error", error: name.code };
    const result = await renameTag(db, user.id, parsed.data.tagId, name.name);
    if (!result.ok) return { status: "error", error: result.code };
    revalidateDependents();
    return { status: "ok", name: result.tag.name };
  }, FAILED);
}

export type DeleteTagResult =
  | { status: "ok"; snapshot: TagSnapshot }
  | { status: "error"; error: TagError };

/**
 * Removes the tag from every transaction; the transactions themselves are untouched. The
 * snapshot (the tag and the ids it was on) is what Undo hands to `restoreTagAction`.
 */
export async function deleteTagAction(tagId: unknown): Promise<DeleteTagResult> {
  return withActionErrorState("Tag delete failed", async (): Promise<DeleteTagResult> => {
    const user = await requireUser();
    const id = z.uuid().safeParse(tagId);
    if (!id.success) return { status: "error", error: "invalidInput" };
    const snapshot = await deleteTag(db, user.id, id.data);
    if (!snapshot) return { status: "error", error: "notFound" };
    revalidateDependents();
    return { status: "ok", snapshot };
  }, FAILED);
}

const MAX_RESTORED_LINKS = 50_000;

/** Everything comes from the client, so the snapshot is validated like a form. */
const snapshotInput = z.object({
  tag: z.object({ id: z.uuid(), name: z.string().max(500) }),
  transactionIds: z.array(z.uuid()).max(MAX_RESTORED_LINKS),
});

/** Undo of a delete: same id and name, re-linked to the transactions that still exist. */
export async function restoreTagAction(snapshot: unknown): Promise<TagActionResult> {
  return withActionErrorState("Tag restore failed", async (): Promise<TagActionResult> => {
    const user = await requireUser();
    const parsed = snapshotInput.safeParse(snapshot);
    if (!parsed.success) return { status: "error", error: "invalidInput" };
    const name = normalizeTagName(parsed.data.tag.name);
    if (!name.ok) return { status: "error", error: name.code };
    const result = await restoreTag(db, user.id, {
      tag: { id: parsed.data.tag.id, name: name.name },
      transactionIds: parsed.data.transactionIds,
    });
    if (!result.ok) return { status: "error", error: result.code === "conflict" ? "conflict" : "saveFailed" };
    revalidateDependents();
    return { status: "ok", name: name.name };
  }, FAILED);
}
