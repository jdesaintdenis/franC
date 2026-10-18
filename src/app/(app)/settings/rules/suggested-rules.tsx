"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { CategoryMarker } from "@/components/category-marker";
import { categoryPath, useSuggestionActions } from "@/components/rule-suggestion-line";
import { Button } from "@/components/ui/button";
import type { RuleSuggestionDetails } from "@/db/queries/guess";

function SuggestionRow({ suggestion, onDone }: { suggestion: RuleSuggestionDetails; onDone: () => void }) {
  const t = useTranslations("settings.rules");
  const tS = useTranslations("settings.rules.suggestions");
  const { pending, create, dismiss } = useSuggestionActions(suggestion, {
    onCreated: onDone,
    onDismissed: onDone,
  });

  return (
    <li className="flex flex-col gap-3 p-3" data-testid="suggested-rule">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-muted-foreground text-sm">{t(`matchType.${suggestion.matchType}`)}</span>
        <code className="bg-muted rounded px-1.5 py-0.5 text-sm break-all">{suggestion.pattern}</code>
        <span aria-hidden="true">→</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm">
          <CategoryMarker icon={suggestion.category.icon} color={suggestion.category.color} />
          {categoryPath(suggestion.category)}
        </span>
      </div>
      <p className="text-muted-foreground text-sm">{tS("wouldCategorize", { count: suggestion.wouldCategorize })}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="h-11" pending={pending} onClick={create}>
          {pending ? tS("creating") : tS("create")}
        </Button>
        <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={dismiss}>
          {tS("notNow")}
        </Button>
      </div>
    </li>
  );
}

/** Suggestions from the user's hand categorizations; a row leaves the list once dismissed. */
export function SuggestedRules({ suggestions: fromServer }: { suggestions: RuleSuggestionDetails[] }) {
  const tS = useTranslations("settings.rules.suggestions");
  // A snapshot: creating a rule revalidates the page, and the toast outlives the row either way.
  const [suggestions] = useState(fromServer);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const keyOf = (s: RuleSuggestionDetails) => `${s.matchType}:${s.pattern}:${s.categoryId}`;
  const visible = suggestions.filter((s) => !dismissed.has(keyOf(s)));
  if (visible.length === 0) return null;

  return (
    <section aria-labelledby="suggested-rules" className="flex flex-col gap-2 rounded-lg border p-4">
      <h2 id="suggested-rules" className="font-medium">
        {tS("heading")}
      </h2>
      <p className="text-muted-foreground text-sm">{tS("intro")}</p>
      <ul aria-label={tS("list")} className="divide-y rounded-lg border">
        {visible.map((s) => (
          <SuggestionRow
            key={keyOf(s)}
            suggestion={s}
            // Dismissed or created, the row goes away; a created rule's result is the toast.
            onDone={() => setDismissed((prev) => new Set(prev).add(keyOf(s)))}
          />
        ))}
      </ul>
    </section>
  );
}
