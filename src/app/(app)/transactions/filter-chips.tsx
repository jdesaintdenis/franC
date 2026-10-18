"use client";

import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { useToday } from "@/components/today-provider";
import { formatShortDay } from "@/lib/format-date";
import { formatCents } from "@/lib/money";
import { monthRange, parseEuroInput, withParams } from "@/lib/transactions/filters";

import type { FilterValues } from "./filters-sheet";

interface Props {
  values: FilterValues;
  /** Canonical query string, the base every chip link builds on. */
  params: string;
  /** Names for the chips of filters that are on; null when the id is no longer known. */
  names: { category: string | null; account: string | null; tag: string | null; merchant: string | null };
}

/**
 * The filters that are on, as removable chips that wrap (the page never scrolls sideways). The
 * Filtres button next to the search opens the sheet that sets them. Chips are plain links built
 * from the canonical params, so they work without JS. The link is the 44 px hit area; the pill
 * inside is smaller.
 */
export function FilterChips({ values, params, names }: Props) {
  const t = useTranslations("transactions.filters");
  const tChips = useTranslations("transactions.chips");
  const tGlossary = useTranslations("common.glossary");
  const locale = useLocale();
  const today = useToday();
  const canonical = new URLSearchParams(params);
  const href = (changes: Record<string, string | null>) => `/transactions${withParams(canonical, changes)}`;

  const month = monthRange(today);
  const thisMonthActive = values.from === month.from && values.to === month.to;

  const chips: { key: string; label: string; clear: Record<string, string | null> }[] = [];
  if (values.review) chips.push({ key: "review", label: tChips("review"), clear: { review: null } });
  if (thisMonthActive) chips.push({ key: "thisMonth", label: t("presets.thisMonth"), clear: { from: null, to: null } });
  if (values.direction === "out") chips.push({ key: "expenses", label: t("expenses"), clear: { direction: null } });
  if (values.direction === "in") chips.push({ key: "income", label: t("income"), clear: { direction: null } });
  if (values.category === "none") chips.push({ key: "uncategorized", label: tGlossary("uncategorized"), clear: { category: null } });
  if (values.merchant && names.merchant) chips.push({ key: "merchant", label: t("merchantChip", { name: names.merchant }), clear: { merchant: null } });
  if (values.category && values.category !== "none" && names.category) chips.push({ key: "category", label: names.category, clear: { category: null } });
  if (values.account && names.account) chips.push({ key: "account", label: names.account, clear: { account: null } });
  if (values.tag && names.tag) chips.push({ key: "tag", label: t("tagChip", { name: names.tag }), clear: { tag: null } });
  if ((values.from || values.to) && !thisMonthActive) {
    const from = values.from ? formatShortDay(values.from, today, locale) : "";
    const to = values.to ? formatShortDay(values.to, today, locale) : "";
    chips.push({
      key: "dates",
      label: values.from && values.to ? t("datesRange", { from, to }) : values.from ? t("datesFrom", { from }) : t("datesTo", { to }),
      clear: { from: null, to: null },
    });
  }
  if (values.min || values.max) {
    const minCents = values.min ? parseEuroInput(values.min) : null;
    const maxCents = values.max ? parseEuroInput(values.max) : null;
    const min = minCents === null ? "" : formatCents(minCents, locale);
    const max = maxCents === null ? "" : formatCents(maxCents, locale);
    const label = min && max ? t("amountRange", { min, max }) : min ? t("amountMin", { min }) : max ? t("amountMax", { max }) : null;
    if (label) chips.push({ key: "amount", label, clear: { min: null, max: null } });
  }
  if (values.transfers) {
    chips.push({ key: "transfers", label: values.transfers === "hide" ? t("transfersHide") : t("transfersOnly"), clear: { transfers: null } });
  }
  if (values.ignored) {
    chips.push({ key: "ignored", label: values.ignored === "show" ? t("ignoredShowChip") : t("ignoredOnlyChip"), clear: { ignored: null } });
  }

  if (chips.length === 0) return null;
  return (
    <div role="group" aria-label={t("quick")} data-testid="filter-chips" className="-my-1 flex flex-wrap gap-x-1.5">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={href(chip.clear)}
          aria-label={t("removeFilter", { label: chip.label })}
          data-testid={`chip-${chip.key}`}
          className="focus-visible:ring-ring/50 inline-flex min-h-11 max-w-full items-center rounded-full outline-none focus-visible:ring-[3px]"
        >
          <span className="bg-secondary text-foreground inline-flex h-8 max-w-full items-center gap-1.5 rounded-full pr-2 pl-3 text-xs font-semibold transition-transform duration-150 ease-out active:scale-[0.97]">
            <span className="truncate">{chip.label}</span>
            <X aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
          </span>
        </Link>
      ))}
    </div>
  );
}
