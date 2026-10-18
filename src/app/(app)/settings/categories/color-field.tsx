"use client";

import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { CATEGORY_PALETTE, parseHexColor } from "@/lib/category-color";
import { cn } from "@/lib/utils";

/**
 * The colour of a category: twelve swatches for a quick pick, and under them the exact colour,
 * as a hex code or through the phone's own picker. The hex field is the one that is submitted.
 */
export function ColorField({
  suffix,
  value,
  swatch,
  onChange,
  usedColors,
  categoryId,
  hint,
  hintId,
}: {
  suffix: string;
  /** The hex text as typed. */
  value: string;
  /** The last valid colour: what the live swatch and the native picker show while the text is mid-edit. */
  swatch: string;
  onChange: (value: string) => void;
  usedColors: { id: string; name: string; color: string }[];
  categoryId?: string;
  hint: string | null;
  hintId: string;
}) {
  const t = useTranslations("settings.categories.form");
  const draft = parseHexColor(value);
  const namesUsing = (color: string) =>
    usedColors
      .filter((c) => c.id !== categoryId && c.color.toLowerCase() === color)
      .map((c) => c.name);

  return (
    <div className="flex flex-col gap-2">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm leading-none font-medium">
          {t("color")}
        </legend>
        <div className="grid grid-cols-6 gap-2">
          {CATEGORY_PALETTE.map((color, i) => {
            const taken = namesUsing(color);
            return (
              <label
                key={color}
                className="relative flex h-10 cursor-pointer items-center justify-center rounded-lg has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
                style={{ backgroundColor: color }}
              >
                <input
                  type="radio"
                  name={`swatch-${suffix}`}
                  className="peer sr-only"
                  checked={draft === color}
                  onChange={() => onChange(color)}
                  aria-label={
                    taken.length > 0
                      ? t("swatchTakenLabel", {
                          index: i + 1,
                          names: taken.join(", "),
                        })
                      : t("swatchLabel", { index: i + 1 })
                  }
                />
                <span
                  aria-hidden="true"
                  className="outline-foreground pointer-events-none absolute inset-0 rounded-lg outline-0 outline-offset-2 peer-checked:outline-[3px]"
                />
                {taken.length > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 bottom-1 size-1.5 rounded-full bg-white"
                  />
                )}
              </label>
            );
          })}
        </div>
      </fieldset>
      <label
        htmlFor={`color-hex-${suffix}`}
        className="text-sm leading-none font-medium"
      >
        {t("exactColor")}
      </label>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="size-12 shrink-0 rounded-lg border"
          style={{ backgroundColor: draft ?? swatch }}
        />
        {/* Only this field is submitted, so the server validates what was typed. */}
        <Input
          id={`color-hex-${suffix}`}
          name="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          maxLength={9}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="#1e3a8a"
          aria-invalid={draft === null || undefined}
          aria-describedby={hint ? hintId : undefined}
          className="h-11 w-32 font-mono"
        />
        <label
          className={cn(
            "bg-secondary text-secondary-foreground focus-within:ring-ring/50 relative flex min-h-11 cursor-pointer items-center rounded-lg border px-3.5 text-sm font-semibold focus-within:ring-[3px]",
          )}
        >
          {t("picker")}
          <input
            type="color"
            aria-label={t("colorPicker")}
            value={swatch}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </div>
      {hint && (
        <p
          id={hintId}
          className="text-muted-foreground text-sm"
          aria-live="polite"
        >
          {hint}
        </p>
      )}
    </div>
  );
}
