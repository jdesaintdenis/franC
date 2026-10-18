import type { getTranslations } from "next-intl/server";

import { isValidationCode, type ValidationCode } from "@/lib/categorize/schemas";

type SettingsT = Awaited<ReturnType<typeof getTranslations<"settings">>>;

const KEYS = {
  name_required: "nameRequired",
  name_too_long: "nameTooLong",
  color_invalid: "colorInvalid",
  category_invalid: "categoryInvalid",
  match_type_invalid: "matchTypeInvalid",
  pattern_required: "patternRequired",
  pattern_too_long: "patternTooLong",
  regex_invalid: "regexInvalid",
  parent_invalid: "parentInvalid",
  icon_invalid: "iconInvalid",
} as const satisfies Record<ValidationCode, string>;

/** Translates the first issue of a failed Zod parse; unknown issues get the generic `fallback`. */
export function validationMessage(t: SettingsT, issues: readonly { message: string }[], fallback: string): string {
  const code = issues[0]?.message;
  return isValidationCode(code) ? t(`validation.${KEYS[code]}`) : fallback;
}
