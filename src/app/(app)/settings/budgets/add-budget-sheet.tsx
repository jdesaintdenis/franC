"use client";

import { ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { CategoryMarker } from "@/components/category-marker";
import { ToastViewport } from "@/components/toast";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { ChargesPreset } from "@/lib/budgets/charges";
import type { BudgetPresets } from "@/lib/budgets/presets";
import { filterSuggestionGroups, selectableSuggestions, type Suggestion, type SuggestionGroup } from "@/lib/budgets/suggestions";
import { formatWholeCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { BudgetForm } from "./budget-form";

// A search field only earns its place on a long list.
const SEARCH_FROM = 10;

/** "Add a budget": pick a category without one (step 1), then set its amount (step 2). */
export function AddBudgetSheet({
  open,
  groups,
  presets,
  chargePresets,
  parentNames,
  onSaved,
  onClose,
}: {
  open: boolean;
  groups: SuggestionGroup[];
  presets: Record<string, BudgetPresets>;
  chargePresets: Record<string, ChargesPreset>;
  /** Parent name by category id, for subcategories. */
  parentNames: Record<string, string>;
  onSaved: (result: { carryReset: boolean }) => void;
  onClose: () => void;
}) {
  const t = useTranslations("settings.budgets");
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const close = () => {
    setPicked(null);
    onClose();
  };
  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      {open && (
        <SheetContent title={picked ? picked.category.name : t("add.title")} className="theme-50f min-h-[50dvh]">
          {picked ? (
            <BudgetForm
              category={{ ...picked.category, parentName: parentNames[picked.category.id] ?? null }}
              existing={null}
              carryCents={null}
              presets={presets[picked.category.id]}
              charges={chargePresets[picked.category.id]}
              suggestedCents={picked.averageCents > 0 ? picked.averageCents : null}
              onSaved={(result) => {
                setPicked(null);
                onSaved(result);
              }}
              onBack={() => setPicked(null)}
            />
          ) : (
            <CategoryList groups={groups} onPick={setPicked} />
          )}
          <ToastViewport inSheet />
        </SheetContent>
      )}
    </Sheet>
  );
}

function CategoryList({ groups, onPick }: { groups: SuggestionGroup[]; onPick: (s: Suggestion) => void }) {
  const t = useTranslations("settings.budgets");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const total = useMemo(() => selectableSuggestions(groups).length, [groups]);
  const shown = useMemo(() => filterSuggestionGroups(groups, query, locale), [groups, query, locale]);

  if (total === 0) return <p className="text-muted-foreground text-sm">{t("add.none")}</p>;

  return (
    <div className="flex flex-col gap-3">
      {total > SEARCH_FROM && (
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("add.search")}
          aria-label={t("add.search")}
          className="h-11"
        />
      )}
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("add.noMatch", { query: query.trim() })}</p>
      ) : (
        <ul aria-label={t("add.listLabel")} className="divide-y rounded-xl border">
          {shown.map(({ parent, children }) => (
            <li key={parent.category.id}>
              {parent.selectable ? (
                <Choice suggestion={parent} onPick={onPick} />
              ) : (
                // A budgeted parent only heads its unbudgeted subcategories.
                <p className="text-muted-foreground flex min-h-11 items-center gap-3 px-4 text-sm font-medium">
                  <CategoryMarker icon={parent.category.icon} color={parent.category.color} />
                  <span className="wrap-anywhere">{parent.category.name}</span>
                </p>
              )}
              {children.length > 0 && (
                <ul className="divide-y border-t">
                  {children.map((child) => (
                    <li key={child.category.id}>
                      <Choice suggestion={child} onPick={onPick} nested />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Choice({ suggestion, onPick, nested = false }: { suggestion: Suggestion; onPick: (s: Suggestion) => void; nested?: boolean }) {
  const t = useTranslations("settings.budgets");
  const locale = useLocale();
  const { category, averageCents } = suggestion;
  return (
    <button
      type="button"
      onClick={() => onPick(suggestion)}
      className={cn(
        "hover:bg-accent/60 focus-visible:ring-ring/50 flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left outline-none focus-visible:ring-[3px]",
        nested && "pl-8",
      )}
    >
      <CategoryMarker icon={category.icon} color={category.color} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("wrap-anywhere", nested ? "font-medium" : "font-semibold")}>{category.name}</span>
        <span className="text-muted-foreground text-sm tabular-nums">
          {averageCents > 0 ? t("add.average", { amount: formatWholeCents(averageCents, locale) }) : t("add.noSpending")}
        </span>
      </span>
      <ChevronRight className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
    </button>
  );
}
