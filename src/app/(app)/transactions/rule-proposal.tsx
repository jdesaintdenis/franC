"use client";

import { Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { categoryPath, useSuggestionActions, type SuggestionCreated } from "@/components/rule-suggestion-line";
import { Button } from "@/components/ui/button";
import type { RuleSuggestionDetails } from "@/db/queries/guess";
import type { RuleProposal } from "@/lib/categorize/propose-rule";

import type { CategorizedResult } from "./sheet-types";

/**
 * What the sheet offers right after a hand category change: the server's stronger suggestion
 * (3+ hand categorizations) when there is one, else a one-tap proposal from the row's own name.
 */
export type RuleOffer =
  | { kind: "suggestion"; suggestion: RuleSuggestionDetails }
  | { kind: "proposal"; proposal: RuleProposal; category: NonNullable<CategorizedResult["category"]> };

/** Pattern, match type and category the offer would create, for Create rule and Adjust. */
export function offerDraft(offer: RuleOffer): { matchType: "equals" | "contains"; pattern: string; categoryId: string; categoryName: string } {
  return offer.kind === "suggestion"
    ? {
        matchType: offer.suggestion.matchType,
        pattern: offer.suggestion.pattern,
        categoryId: offer.suggestion.categoryId,
        categoryName: categoryPath(offer.suggestion.category),
      }
    : {
        matchType: offer.proposal.matchType,
        pattern: offer.proposal.pattern,
        categoryId: offer.proposal.categoryId,
        categoryName: categoryPath(offer.category),
      };
}

interface Props {
  offer: RuleOffer;
  onCreated: (created: SuggestionCreated) => void;
  onAdjust: () => void;
  onDismissed: () => void;
}

/** "Always put Carrefour in Groceries?" with Create rule, Adjust and a dismiss ✕. */
export function RuleProposalCard({ offer, onCreated, onAdjust, onDismissed }: Props) {
  const t = useTranslations("transactions.sheet.rule");
  const tSuggestion = useTranslations("transactions.guess.suggestion");
  const draft = offerDraft(offer);
  const { pending, create, dismiss } = useSuggestionActions(
    { matchType: draft.matchType, pattern: draft.pattern, categoryId: draft.categoryId },
    { onCreated, onDismissed },
  );

  return (
    <section
      role="region"
      aria-label={tSuggestion("region")}
      data-testid="rule-suggestion"
      className="bg-muted/50 flex flex-col gap-3 rounded-xl border p-3 text-sm"
    >
      <div className="flex items-start gap-2">
        <Sparkles aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <p className="min-w-0 flex-1 break-words">
          {offer.kind === "suggestion"
            ? tSuggestion("line", { count: offer.suggestion.count, pattern: draft.pattern, category: draft.categoryName })
            : t("question", { name: draft.pattern, category: draft.categoryName })}
        </p>
        <button
          type="button"
          aria-label={t("dismiss")}
          disabled={pending}
          // A proposal lives only here; a server suggestion is remembered as dismissed.
          onClick={offer.kind === "suggestion" ? dismiss : onDismissed}
          className="hover:bg-accent focus-visible:ring-ring/50 -my-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="h-11 flex-1" disabled={pending} onClick={create}>
          {pending ? t("creating") : t("create")}
        </Button>
        <Button type="button" variant="outline" className="h-11 flex-1" disabled={pending} onClick={onAdjust}>
          {t("adjust")}
        </Button>
      </div>
    </section>
  );
}
