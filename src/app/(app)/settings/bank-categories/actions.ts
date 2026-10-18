"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { db } from "@/db/client";
import { forgetBankMapping, getOwnedBankMapping, updateBankMapping } from "@/db/queries/bank-categories";
import { requireUser } from "@/lib/auth/session";
import { withActionErrors } from "@/lib/actions/safe-action";

export type BankMappingResult =
  | { status: "ok"; rowsUpdated: number }
  | { status: "error"; error: string };

export type ForgetResult = { status: "ok" } | { status: "error"; error: string };

const updateInput = z.object({ mappingId: z.uuid(), categoryId: z.uuid().nullable() });

function revalidateAll() {
  revalidatePath("/settings/bank-categories");
  revalidatePath("/transactions");
}

/** Changes the category of a stored mapping (null = Ignore) and re-applies it. */
export async function updateBankMappingAction(input: {
  mappingId: string;
  categoryId: string | null;
}): Promise<BankMappingResult> {
  const t = await getTranslations("settings.bankCategories");
  return withActionErrors(t("saveError"), async () => {
    const user = await requireUser();
    const parsed = updateInput.safeParse(input);
    if (!parsed.success) return { status: "error" as const, error: t("errors.notFound") };

    // The mapping is looked up by id scoped to the user; its bank names come from the row, never the client.
    const mapping = await getOwnedBankMapping(db, user.id, parsed.data.mappingId);
    if (!mapping) return { status: "error" as const, error: t("errors.notFound") };

    const result = await updateBankMapping(db, user.id, {
      bankCategory: mapping.bankCategory,
      bankSubcategory: mapping.bankSubcategory,
      categoryId: parsed.data.categoryId,
    });
    if (!result.ok) return { status: "error" as const, error: t("errors.categoryNotFound") };

    revalidateAll();
    return { status: "ok" as const, rowsUpdated: result.rowsUpdated };
  });
}

/** Removes a mapping: the bank category is asked about again at the next import. */
export async function forgetBankMappingAction(mappingId: string): Promise<ForgetResult> {
  const t = await getTranslations("settings.bankCategories");
  return withActionErrors(t("forget.error"), async () => {
    const user = await requireUser();
    const id = z.uuid().safeParse(mappingId);
    if (!id.success) return { status: "error" as const, error: t("errors.notFound") };
    if (!(await forgetBankMapping(db, user.id, id.data))) {
      return { status: "error" as const, error: t("errors.notFound") };
    }
    revalidateAll();
    return { status: "ok" as const };
  });
}
