"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import type { BankDecision, BankDecisions, BankPlan, BankPlanItem } from "@/lib/categorize/bank";
import { HomeSection } from "../home/home-section";
import {
  decisionToSelectValue,
  planItems,
  selectValueToDecision,
  summarizeDecisions,
} from "@/lib/categorize/bank-decisions";

type CategoryOption = { id: string; label: string };

/**
 * The bank's categories that have no stored mapping yet: a summary with the names that will be created,
 * and a sheet to create, map or ignore each one.
 */
export function BankCategoriesStep({
  plan,
  options,
  decisions,
  onChange,
  onCreateAll,
  disabled,
}: {
  plan: BankPlan;
  options: CategoryOption[];
  decisions: BankDecisions;
  onChange: (key: string, decision: BankDecision | null) => void;
  onCreateAll: () => void;
  disabled: boolean;
}) {
  const t = useTranslations("import.bank");
  const summary = summarizeDecisions(plan, decisions);
  const [open, setOpen] = useState(false);
  const labelOf = (id: string | null) => options.find((o) => o.id === id)?.label ?? "";

  function control(item: BankPlanItem, label: string) {
    return (
      <select
        aria-label={label}
        value={decisionToSelectValue(decisions[item.key])}
        onChange={(e) => onChange(item.key, selectValueToDecision(e.target.value))}
        disabled={disabled}
        className={`${NATIVE_SELECT_CLASS} h-11 w-full sm:w-56`}
      >
        <option value="">{t("chooseLabel")}</option>
        <option value="create">{t("create")}</option>
        <option value="ignore">{t("ignore")}</option>
        {options.length > 0 && (
          <optgroup label={t("mapTo")}>
            {options.map((o) => (
              <option key={o.id} value={`map:${o.id}`}>
                {o.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    );
  }

  const PILLS = 6;
  const creating = plan.groups.flatMap((g) => (g.category && decisions[g.category.key]?.action === "create" ? [g.bankCategory] : []));
  const count = planItems(plan).length;
  const decided = summary.create + summary.map + summary.ignore > 0;

  return (
    <>
      <HomeSection
        headingId="bank-categories-heading"
        title={t("headingCount", { count })}
        action={{ label: t("choose"), onClick: () => setOpen(true) }}
      >
        <div className="flex flex-col gap-2.5">
          {decided && (
            <p role="status" className="text-muted-foreground text-sm">
              {summary.map === 0 && summary.ignore === 0
                ? t("autoSummary", { create: summary.create })
                : t("mixedSummary", { create: summary.create, map: summary.map, ignore: summary.ignore })}
            </p>
          )}
          {creating.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {creating.slice(0, PILLS).map((name) => (
                <li key={name} className="bg-secondary min-h-8 rounded-full px-3 py-1.5 text-xs font-semibold break-all">
                  {name}
                </li>
              ))}
              {creating.length > PILLS && (
                <li className="text-muted-foreground min-h-8 rounded-full border border-dashed px-3 py-1.5 text-xs font-semibold">
                  {t("more", { count: creating.length - PILLS })}
                </li>
              )}
            </ul>
          )}
          {summary.undecided > 0 && <p className="text-muted-foreground text-xs">{t("undecidedNote")}</p>}
        </div>
      </HomeSection>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="theme-50f" title={t("headingCount", { count })} description={t("sheetIntro")}>
          <div className="flex flex-col gap-3">
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={onCreateAll} disabled={disabled}>
                {t("createAll")}
              </Button>
            </div>
            <ul className="divide-y rounded-md border text-sm">
              {plan.groups.map((group) => (
                <li key={group.bankCategory} className="flex flex-col gap-3 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium break-words">{group.bankCategory}</span>
                      <span className="text-muted-foreground text-xs">{t("rows", { count: group.rowCount })}</span>
                    </span>
                    {group.category ? (
                      control(group.category, group.bankCategory)
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {group.storedCategoryId === null
                          ? t("alreadyIgnored")
                          : t("alreadyMapped", { name: labelOf(group.storedCategoryId) })}
                      </span>
                    )}
                  </div>
                  {group.subcategories.length > 0 && (
                    <ul className="flex flex-col gap-3 border-l pl-3">
                      {group.subcategories.map((sub) => (
                        <li key={sub.key} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className="flex min-w-0 flex-col">
                            <span className="break-words">{sub.bankSubcategory}</span>
                            <span className="text-muted-foreground text-xs">{t("rows", { count: sub.rowCount })}</span>
                          </span>
                          {control(sub, t("subcategoryOf", { sub: sub.bankSubcategory ?? "", category: group.bankCategory }))}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            <Button type="button" className="h-12 w-full rounded-xl font-bold" onClick={() => setOpen(false)}>
              {t("done")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
