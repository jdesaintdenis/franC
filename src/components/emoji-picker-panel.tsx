"use client";

import { EmojiPicker } from "frimousse";
import { useLocale, useTranslations } from "next-intl";

/** Where the self-hosted Emojibase files live (see src/app/api/emoji-data). */
const EMOJIBASE_URL = "/api/emoji-data";

/**
 * The searchable emoji grid. It is only ever imported through `next/dynamic` from
 * icon-field.tsx, so the library and its data load when the dialog first opens, not with
 * the page. Group names and search keywords come from Emojibase in the UI language.
 */
export default function EmojiPickerPanel({ onSelect }: { onSelect: (emoji: string) => void }) {
  const locale = useLocale();
  const t = useTranslations("settings.categories.form.icon");
  return (
    <EmojiPicker.Root
      locale={locale === "fr" ? "fr" : "en"}
      emojibaseUrl={EMOJIBASE_URL}
      columns={8}
      onEmojiSelect={({ emoji }) => onSelect(emoji)}
      className="flex h-80 w-full flex-col"
    >
      <EmojiPicker.Search
        aria-label={t("search")}
        placeholder={t("search")}
        className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px] md:text-sm"
      />
      {/* Focusable so keyboard users can scroll the region (axe: scrollable-region-focusable). */}
      <EmojiPicker.Viewport
        tabIndex={0}
        className="focus-visible:ring-ring/50 relative mt-2 flex-1 rounded-md outline-none focus-visible:ring-[3px]"
      >
        <EmojiPicker.Loading className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
          {t("loading")}
        </EmojiPicker.Loading>
        <EmojiPicker.Empty className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
          {t("noResults")}
        </EmojiPicker.Empty>
        <EmojiPicker.List
          className="select-none pb-1"
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div
                className="bg-background text-muted-foreground px-1 pt-2 pb-1 text-xs font-medium"
                {...props}
              >
                {category.label}
              </div>
            ),
            // Frimousse counts rows and columns from 0, but ARIA indexes start at 1.
            Row: ({ children, ...props }) => (
              <div className="scroll-my-1" {...props} aria-rowindex={Number(props["aria-rowindex"]) + 1}>
                {children}
              </div>
            ),
            // Frimousse passes role="gridcell" in props, which the lint rule cannot see.
            Emoji: ({ emoji, ...props }) => (
              // eslint-disable-next-line jsx-a11y/role-supports-aria-props
              <button
                className="data-[active]:bg-accent flex size-9 items-center justify-center rounded-md text-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                {...props}
                aria-colindex={Number(props["aria-colindex"]) + 1}
              >
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </EmojiPicker.Viewport>
    </EmojiPicker.Root>
  );
}
