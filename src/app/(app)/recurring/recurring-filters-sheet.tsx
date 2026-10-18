"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  recurringHref,
  UNCATEGORIZED,
  type RecurringSort,
  type RecurringView,
} from "@/lib/recurring/list-view";

const ROW =
  "hover:bg-muted focus-visible:ring-ring/50 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base outline-none focus-visible:ring-[3px]";

/**
 * Sort and category in one sheet, opened by "Trier". Both apply the moment they are chosen: they
 * navigate to the same page with new params, so the view stays shareable and server-rendered.
 */
export function RecurringFiltersSheet({
  open,
  onClose,
  view,
  accountId,
  categories,
  hasUncategorized,
}: {
  open: boolean;
  onClose: () => void;
  view: RecurringView;
  /** Kept in the URL so the account links and the view combine. */
  accountId: string | null;
  /** Only the categories recurring items use, in tree order with path labels. */
  categories: { id: string; label: string }[];
  hasUncategorized: boolean;
}) {
  const t = useTranslations("recurring.filters");
  const tGlossary = useTranslations("common.glossary");
  const router = useRouter();

  function go(next: Partial<RecurringView>) {
    onClose();
    router.push(recurringHref(accountId, { ...view, ...next }));
  }

  const sorts: { value: RecurringSort; label: string }[] = [
    { value: "next", label: t("sortNext") },
    { value: "yearly", label: t("sortYearly") },
  ];
  const options: { key: string; label: string; value: string | null }[] = [
    { key: "all", label: t("all"), value: null },
    ...(hasUncategorized
      ? [
          {
            key: UNCATEGORIZED,
            label: tGlossary("uncategorized"),
            value: UNCATEGORIZED,
          },
        ]
      : []),
    ...categories.map((c) => ({ key: c.id, label: c.label, value: c.id })),
  ];

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent title={t("label")} className="theme-50f min-h-[50dvh]">
        <div className="flex flex-col gap-3">
          <section
            aria-labelledby="recurring-sort-by"
            className="flex flex-col"
          >
            <h3
              id="recurring-sort-by"
              className="font-title text-primary px-3 pb-1 text-xs font-semibold tracking-[0.14em] uppercase"
            >
              {t("sortBy")}
            </h3>
            <ul>
              {sorts.map((s) => (
                <li key={s.value}>
                  <button
                    type="button"
                    aria-pressed={view.sort === s.value}
                    onClick={() => go({ sort: s.value })}
                    className={ROW}
                  >
                    <span className="flex-1">{s.label}</span>
                    {view.sort === s.value && (
                      <Check
                        aria-hidden="true"
                        className="text-primary size-5 shrink-0"
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section
            aria-labelledby="recurring-category"
            className="flex flex-col"
          >
            <h3
              id="recurring-category"
              className="font-title text-primary px-3 pb-1 text-xs font-semibold tracking-[0.14em] uppercase"
            >
              {t("category")}
            </h3>
            <ul>
              {options.map((o) => (
                <li key={o.key}>
                  <button
                    type="button"
                    aria-pressed={o.value === view.category}
                    onClick={() => go({ category: o.value })}
                    className={ROW}
                  >
                    <span className="flex-1">{o.label}</span>
                    {o.value === view.category && (
                      <Check
                        aria-hidden="true"
                        className="text-primary size-5 shrink-0"
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
