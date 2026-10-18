"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { createSuggestedRuleAction, dismissRuleSuggestionAction } from "@/app/(app)/settings/rules/actions";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { RuleSuggestionDetails } from "@/db/queries/guess";
import { CATEGORY_PATH_SEPARATOR } from "@/lib/categorize/hierarchy";
import { cn } from "@/lib/utils";

/** The fields the actions need; also what Settings > Rules passes for its rows. */
export type SuggestionInput = Pick<RuleSuggestionDetails, "matchType" | "pattern" | "categoryId">;

export interface SuggestionCreated {
  categorized: number;
  byCategory: Record<string, string[]>;
  /** The new rule, so Undo can delete it. */
  ruleId: string;
}

export function categoryPath(category: RuleSuggestionDetails["category"]): string {
  return category.parentName ? `${category.parentName}${CATEGORY_PATH_SEPARATOR}${category.name}` : category.name;
}

/**
 * Create / dismiss logic shared by the one-line suggestion and the Settings list. Both actions
 * take only match type, pattern and category: the server re-checks everything.
 */
export function useSuggestionActions(input: SuggestionInput, handlers: { onCreated?: (r: SuggestionCreated) => void; onDismissed?: () => void }) {
  const t = useTranslations("settings.rules.suggestions");
  const tToast = useTranslations("common.toast");
  const toast = useToast();
  const [created, setCreated] = useState<number | null>(null);
  const [pending, start] = useTransition();

  // A failure is a toast with Try again; a success is a toast too, so the suggestion simply goes away.
  function fail(message: string, retry: () => void) {
    toast.show({ message, variant: "error", action: { label: tToast("retry"), onAction: retry } });
  }

  function create() {
    start(async () => {
      try {
        const result = await createSuggestedRuleAction({ matchType: input.matchType, pattern: input.pattern, categoryId: input.categoryId });
        if (result.status === "error") {
          fail(result.error, create);
          return;
        }
        setCreated(result.categorized);
        toast.show({ message: t("created", { count: result.categorized }) });
        handlers.onCreated?.({ categorized: result.categorized, byCategory: result.byCategory, ruleId: result.ruleId });
      } catch {
        fail(t("error"), create);
      }
    });
  }

  function dismiss() {
    start(async () => {
      try {
        const result = await dismissRuleSuggestionAction({ matchType: input.matchType, pattern: input.pattern, categoryId: input.categoryId });
        if (result.status === "error") {
          fail(result.error, dismiss);
          return;
        }
        handlers.onDismissed?.();
      } catch {
        fail(t("error"), dismiss);
      }
    });
  }

  return { created, pending, create, dismiss };
}

interface Props {
  suggestion: RuleSuggestionDetails;
  onCreated?: (result: SuggestionCreated) => void;
  onDismissed?: () => void;
  className?: string;
}

/** "You put 3 BOULANGERIE DES L in Food. Always do this?" with Create rule / Not now. */
export function RuleSuggestionLine({ suggestion, onCreated, onDismissed, className }: Props) {
  const t = useTranslations("transactions.guess.suggestion");
  const tS = useTranslations("settings.rules.suggestions");
  const { created, pending, create, dismiss } = useSuggestionActions(suggestion, { onCreated, onDismissed });

  // Once created, the result is the toast: the offer just goes away.
  if (created !== null) return null;

  return (
    <section
      role="status"
      aria-label={t("region")}
      data-testid="rule-suggestion"
      className={cn("bg-card flex flex-col gap-3 rounded-lg border p-3 text-sm", className)}
    >
      <p className="flex items-start gap-2">
        <Sparkles aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <span className="break-words">
          {t("line", { count: suggestion.count, pattern: suggestion.pattern, category: categoryPath(suggestion.category) })}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="h-11 flex-1 sm:flex-none" disabled={pending} onClick={create}>
          {pending ? tS("creating") : tS("create")}
        </Button>
        <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" disabled={pending} onClick={dismiss}>
          {tS("notNow")}
        </Button>
      </div>
    </section>
  );
}
