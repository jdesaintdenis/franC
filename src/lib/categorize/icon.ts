import { z } from "zod";

export const MAX_CATEGORY_ICON = 32;

// Built with `new RegExp` because the tsconfig target (ES2017) rejects the `v` flag in a
// literal. `RGI_Emoji` matches exactly one emoji (skin tones, flags and ZWJ sequences
// included); it also rejects bare "#" or digits, which are only emoji as keycap bases.
const SINGLE_EMOJI = new RegExp("^\\p{RGI_Emoji}$", "v");

export function isSingleEmoji(value: string): boolean {
  return SINGLE_EMOJI.test(value);
}

/**
 * The canonical (RGI) spelling of a single emoji, or null when `value` is not one. Emojibase,
 * which feeds the picker, writes some emoji with a trailing variation selector (🏠 as
 * U+1F3E0 U+FE0F) that RGI only knows without it, so retry once with the selectors removed.
 * Text-default emoji such as 🛋️ keep theirs: RGI requires it.
 */
export function canonicalEmoji(value: string): string | null {
  if (isSingleEmoji(value)) return value;
  const bare = value.replaceAll("\uFE0F", "");
  return isSingleEmoji(bare) ? bare : null;
}

/**
 * A category icon from a form field: trimmed, "" (or whitespace) becomes null (clears the
 * icon), anything else must be exactly one emoji. Issues carry codes, translated at the UI.
 */
export const categoryIconSchema = z
  .string("icon_invalid")
  .trim()
  .transform((value, ctx): string | null => {
    if (value === "") return null;
    const emoji = value.length > MAX_CATEGORY_ICON ? null : canonicalEmoji(value);
    if (emoji === null) {
      ctx.addIssue({ code: "custom", message: "icon_invalid" });
      return z.NEVER;
    }
    return emoji;
  });

/** "🏠 Housing": the name prefixed with its icon when there is one (native <option> text). */
export function withIcon(icon: string | null | undefined, name: string): string {
  return icon ? `${icon} ${name}` : name;
}
