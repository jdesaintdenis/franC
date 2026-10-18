"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/toast";
import { NATIVE_CHECKBOX_CLASS } from "@/components/ui/native-select";

import { setLocale } from "./language-actions";

export type LanguageChoice = "auto" | "fr" | "en";

const CHOICES: readonly LanguageChoice[] = ["auto", "fr", "en"];

export function LanguagePicker({ current }: { current: LanguageChoice }) {
  const t = useTranslations("settings.language");
  const tToast = useTranslations("common.toast");
  const toast = useToast();
  const router = useRouter();
  const [selected, setSelected] = useState<LanguageChoice>(current);
  const [pending, startTransition] = useTransition();

  function choose(choice: LanguageChoice) {
    if (pending || choice === selected) return;
    const previous = selected;
    setSelected(choice);
    // The page changing language is the feedback; only a failure says anything, as a toast.
    const failed = () => {
      setSelected(previous);
      toast.show({ message: t("error"), variant: "error", action: { label: tToast("retry"), onAction: () => choose(choice) } });
    };
    startTransition(async () => {
      try {
        const result = await setLocale(choice);
        if (result.status === "error") return failed();
        // The action revalidates the layout; refresh also re-reads the new cookie for client messages.
        router.refresh();
      } catch {
        failed();
      }
    });
  }

  return (
    <fieldset aria-busy={pending} className="flex flex-col gap-2">
      <legend className="mb-2 font-medium">{t("legend")}</legend>
      <div className="divide-y rounded-lg border">
        {CHOICES.map((choice) => (
          // Language names stay in their own language so they can be found from any UI language.
          <label
            key={choice}
            lang={choice === "auto" ? undefined : choice}
            className="hover:bg-accent flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2"
          >
            <input
              type="radio"
              name="language"
              value={choice}
              checked={selected === choice}
              onChange={() => choose(choice)}
              className={`${NATIVE_CHECKBOX_CLASS} size-4`}
            />
            {t(choice)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
