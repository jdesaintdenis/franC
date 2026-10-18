"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { db } from "@/db/client";
import {
  createCategory,
  deleteCategory,
  deleteCategoryIfUnused,
  restoreCategory,
  type CategorySnapshot,
  type CategoryUsage,
  type DeleteCategoryOption,
  updateCategory,
  type CategoryWriteError,
} from "@/db/queries/categories";
import { requireUser } from "@/lib/auth/session";
import { withActionErrors } from "@/lib/actions/safe-action";
import { categoryIconSchema } from "@/lib/categorize/icon";
import { categoryInput } from "@/lib/categorize/schemas";

import { validationMessage } from "../validation-errors";

const DELETE_OPTIONS = ["uncategorize", "move_to_parent", "keep_subcategories", "delete_subcategories"] as const satisfies readonly DeleteCategoryOption[];

/** On create, the new category so a picker can use it at once (Slice 54). */
export type CreatedCategory = { id: string; name: string; color: string; icon: string | null; parentId: string | null };
export type CategoryFormState = { status: "ok"; category?: CreatedCategory } | { status: "error"; error: string } | undefined;

type Translator = Awaited<ReturnType<typeof getTranslations<"settings">>>;

const ERROR_KEYS = {
  name_taken: "nameTaken",
  not_found: "notFound",
  parent_not_found: "parentNotFound",
  parent_is_self: "parentIsSelf",
  parent_is_subcategory: "parentIsSubcategory",
  has_subcategories: "hasSubcategories",
  subcategory_name_taken: "subcategoryNameTaken",
} as const satisfies Record<CategoryWriteError | "subcategory_name_taken", string>;

function errorMessage(t: Translator, code: keyof typeof ERROR_KEYS): string {
  return t(`categories.errors.${ERROR_KEYS[code]}`);
}

function revalidateAll() {
  revalidatePath("/settings/categories");
  revalidatePath("/settings/rules");
  revalidatePath("/settings/budgets");
  revalidatePath("/transactions");
  revalidatePath("/review");
}

function invalidInput(t: Translator, issues: readonly { message: string }[]): CategoryFormState {
  return { status: "error", error: validationMessage(t, issues, t("validation.invalidCategory")) };
}

function parseInput(formData: FormData) {
  // parentId is only sent by forms that let the user pick a parent (absent = unchanged).
  const parentId = formData.get("parentId");
  // "" clears the icon; a form without the field leaves it unchanged.
  const icon = formData.get("icon");
  return categoryInput.safeParse({
    name: formData.get("name"),
    color: formData.get("color"),
    ...(parentId === null ? {} : { parentId }),
    ...(icon === null ? {} : { icon }),
  });
}

export async function createCategoryAction(_prev: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("categories.form.addError"), () => createCategoryImpl(t, formData));
}

async function createCategoryImpl(t: Translator, formData: FormData): Promise<CategoryFormState> {
  const user = await requireUser();
  const parsed = parseInput(formData);
  if (!parsed.success) return invalidInput(t, parsed.error.issues);

  const result = await createCategory(db, user.id, parsed.data);
  if (!result.ok) return { status: "error", error: errorMessage(t, result.error) };

  revalidateAll();
  const { id, name, color, icon, parentId } = result.category;
  return { status: "ok", category: { id, name, color, icon: icon ?? null, parentId: parentId ?? null } };
}

export async function updateCategoryAction(_prev: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("categories.form.saveError"), () => updateCategoryImpl(t, formData));
}

async function updateCategoryImpl(t: Translator, formData: FormData): Promise<CategoryFormState> {
  const user = await requireUser();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { status: "error", error: errorMessage(t, "not_found") };
  const parsed = parseInput(formData);
  if (!parsed.success) return invalidInput(t, parsed.error.issues);

  const result = await updateCategory(db, user.id, id.data, parsed.data);
  if (!result.ok) return { status: "error", error: errorMessage(t, result.error) };

  revalidateAll();
  return { status: "ok" };
}

export type TryDeleteCategoryState =
  | { status: "deleted"; snapshot: CategorySnapshot }
  | { status: "in_use"; usage: CategoryUsage }
  | { status: "error"; error: string };

/**
 * First step of "Delete": deletes at once when nothing depends on the category (the client then
 * offers Undo); otherwise changes nothing and returns what depends on it for the choices sheet.
 */
export async function tryDeleteCategoryAction(categoryId: string): Promise<TryDeleteCategoryState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("categories.delete.error"), async (): Promise<TryDeleteCategoryState> => {
    const user = await requireUser();
    const id = z.uuid().safeParse(categoryId);
    if (!id.success) return { status: "error", error: errorMessage(t, "not_found") };
    const result = await deleteCategoryIfUnused(db, user.id, id.data);
    if (result.status === "not_found") return { status: "error", error: errorMessage(t, "not_found") };
    if (result.status === "in_use") return result;
    revalidateAll();
    return result;
  });
}

/** Everything comes from the client, so the snapshot is validated like a form. */
const snapshotSchema = z.object({
  id: z.uuid(),
  name: categoryInput.shape.name,
  color: categoryInput.shape.color,
  icon: z.union([z.null(), categoryIconSchema]),
  parentId: z.uuid().nullable(),
});

/** Undo of an immediate delete. */
export async function restoreCategoryAction(snapshot: unknown): Promise<CategoryFormState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("manage.undoFailed"), async (): Promise<CategoryFormState> => {
    const user = await requireUser();
    const parsed = snapshotSchema.safeParse(snapshot);
    if (!parsed.success) return { status: "error", error: t("manage.undoFailed") };
    const result = await restoreCategory(db, user.id, parsed.data);
    if (!result.ok) {
      return {
        status: "error",
        error: result.error === "name_taken" ? errorMessage(t, "name_taken") : t("categories.errors.cannotRestore"),
      };
    }
    revalidateAll();
    return { status: "ok" };
  });
}

const deleteOptionSchema = z.enum(DELETE_OPTIONS).optional();

export async function deleteCategoryAction(
  categoryId: string,
  option?: DeleteCategoryOption,
): Promise<{ status: "ok" } | { status: "error"; error: string }> {
  const user = await requireUser();
  const t = await getTranslations("settings");
  const id = z.uuid().safeParse(categoryId);
  if (!id.success) return { status: "error", error: errorMessage(t, "not_found") };
  const parsedOption = deleteOptionSchema.safeParse(option);
  if (!parsedOption.success) return { status: "error", error: t("categories.delete.error") };
  const result = await deleteCategory(db, user.id, id.data, parsedOption.data);
  if (!result.ok) return { status: "error", error: errorMessage(t, result.error) };

  revalidateAll();
  return { status: "ok" };
}
