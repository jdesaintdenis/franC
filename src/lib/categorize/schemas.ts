import { z } from "zod";

import { parseHexColor } from "../category-color";
import { normalizeLabel } from "../import/normalize-label";
import { categoryIconSchema } from "./icon";

export const MAX_CATEGORY_NAME = 50;
export const MAX_PATTERN = 200;

/**
 * Validation issues carry one of these codes as their message, so this module
 * stays language-free; the UI translates the code (see settings/validation-errors.ts).
 */
export const VALIDATION_CODES = [
  "name_required",
  "name_too_long",
  "color_invalid",
  "icon_invalid",
  "category_invalid",
  "match_type_invalid",
  "pattern_required",
  "pattern_too_long",
  "regex_invalid",
  "parent_invalid",
] as const;
export type ValidationCode = (typeof VALIDATION_CODES)[number];

export function isValidationCode(value: unknown): value is ValidationCode {
  return (VALIDATION_CODES as readonly unknown[]).includes(value);
}

export const categoryInput = z.object({
  name: z.string().trim().min(1, "name_required").max(MAX_CATEGORY_NAME, "name_too_long"),
  // Accepts "1E3A8A" or "#1e3a8a"; stored lowercase with "#" so one colour has one spelling.
  color: z.string("color_invalid").transform((value, ctx) => {
    const hex = parseHexColor(value);
    if (hex === null) {
      ctx.addIssue({ code: "custom", message: "color_invalid" });
      return z.NEVER;
    }
    return hex;
  }),
  // Forms send "" for "no parent"; undefined means "leave unchanged" on update.
  parentId: z.preprocess(
    (v) => (v === "" ? null : v),
    z.uuid("parent_invalid").nullable().optional(),
  ),
  // undefined leaves the icon unchanged on update; null (from "") clears it.
  icon: categoryIconSchema.optional(),
});
export type CategoryInput = z.infer<typeof categoryInput>;

export const ruleMatchTypeSchema = z.enum(["contains", "equals", "regex"], "match_type_invalid");

export const ruleInput = z
  .object({
    categoryId: z.uuid("category_invalid"),
    matchType: ruleMatchTypeSchema,
    pattern: z.string().trim().min(1, "pattern_required").max(MAX_PATTERN, "pattern_too_long"),
  })
  .superRefine((rule, ctx) => {
    if (rule.matchType === "regex") {
      try {
        new RegExp(rule.pattern, "iu");
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["pattern"],
          message: "regex_invalid",
        });
      }
    } else if (normalizeLabel(rule.pattern) === "") {
      ctx.addIssue({
        code: "custom",
        path: ["pattern"],
        message: "pattern_required",
      });
    }
  });
export type RuleInputData = z.infer<typeof ruleInput>;
