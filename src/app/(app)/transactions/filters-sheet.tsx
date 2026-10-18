"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { NoCategoriesHint } from "@/components/no-categories-hint";
import { useToday } from "@/components/today-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  formatDayInput,
  parseDayInput,
  periodPreset,
  withParams,
  type Direction,
  type PeriodPreset,
  type IgnoredFilter,
  type TransferFilter,
} from "@/lib/transactions/filters";
import { cn } from "@/lib/utils";

export interface FilterValues {
  q: string;
  /** ISO dates, as carried in the URL. */
  from: string;
  to: string;
  category: string;
  /** Account id, or "" for all accounts. */
  account: string;
  /** Euro text, as carried in the URL. */
  min: string;
  max: string;
  direction: Direction;
  /** "" shows everything. */
  transfers: TransferFilter | "";
  /** "" hides ignored transactions. */
  ignored: IgnoredFilter | "";
  /** Merchant id from the URL (set from a recurring item); kept through the sheet, cleared by its chip. */
  merchant: string;
  /** Tag id, or "" for all tags. */
  tag: string;
  /** "todo" keeps only the rows still to review; set by the À valider row, kept through the sheet, cleared by its chip. */
  review: "todo" | "";
}

const DIRECTIONS = [
  { value: "all", labelKey: "all" },
  { value: "out", labelKey: "expenses" },
  { value: "in", labelKey: "income" },
] as const satisfies readonly { value: Direction; labelKey: string }[];

const PRESETS: readonly PeriodPreset[] = ["thisMonth", "lastMonth", "last3Months", "thisYear"];

const selectClass = `${NATIVE_SELECT_CLASS} h-11`;

interface SheetProps {
  values: FilterValues;
  categories: { id: string; label: string }[];
  /** Empty with a single account: the select is hidden then. */
  accounts: { id: string; name: string }[];
  /** The user's tags; the select is hidden when there are none. */
  tags: { id: string; name: string }[];
  /** How many filters are on; the badge shows only above zero. */
  activeCount: number;
}

/** The "Filters" chip and the sheet it opens; Apply batches several changes into one navigation. */
export function FiltersSheet({ activeCount, ...rest }: SheetProps) {
  const t = useTranslations("transactions.filters");
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={activeCount > 0 ? `${t("button")} · ${t("buttonCount", { count: activeCount })}` : undefined}
          data-testid="filters-button"
          className="bg-secondary hover:bg-secondary/80 focus-visible:ring-ring/50 inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-semibold outline-none focus-visible:ring-[3px]"
        >
          {t("button")}
          {activeCount > 0 && (
            <span aria-hidden="true" className="bg-primary text-primary-foreground flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold">
              {activeCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent title={t("sheetTitle")} className="theme-50f">
        {/* Mounted only while open, so each opening starts from the URL's values. */}
        <FiltersForm {...rest} onDone={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function FiltersForm({ values, categories, accounts, tags, onDone }: Omit<SheetProps, "activeCount"> & { onDone: () => void }) {
  const t = useTranslations("transactions.filters");
  const tGlossary = useTranslations("common.glossary");
  const tAccounts = useTranslations("common.accounts");
  const router = useRouter();
  const today = useToday();
  const [from, setFrom] = useState(formatDayInput(values.from));
  const [to, setTo] = useState(formatDayInput(values.to));
  const [invalid, setInvalid] = useState<{ from: boolean; to: boolean }>({ from: false, to: false });
  const [direction, setDirection] = useState<Direction>(values.direction);

  const parsedFrom = from.trim() === "" ? null : parseDayInput(from);
  const parsedTo = to.trim() === "" ? null : parseDayInput(to);

  function applyPreset(preset: PeriodPreset) {
    const range = periodPreset(preset, today);
    setFrom(formatDayInput(range.from));
    setTo(formatDayInput(range.to));
    setInvalid({ from: false, to: false });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const fromBad = from.trim() !== "" && parsedFrom === null;
    const toBad = to.trim() !== "" && parsedTo === null;
    setInvalid({ from: fromBad, to: toBad });
    if (fromBad || toBad) return;
    let isoFrom = parsedFrom;
    let isoTo = parsedTo;
    if (isoFrom && isoTo && isoFrom > isoTo) [isoFrom, isoTo] = [isoTo, isoFrom];
    const query = withParams(new URLSearchParams(), {
      q: values.q || null,
      merchant: values.merchant || null,
      from: isoFrom,
      to: isoTo,
      category: text("category") || null,
      account: text("account") || null,
      tag: text("tag") || null,
      min: text("min") || null,
      max: text("max") || null,
      direction: direction === "all" ? null : direction,
      transfers: text("transfers") || null,
      ignored: text("ignored") || null,
      review: values.review || null,
    });
    onDone();
    router.push(`/transactions${query}`);
  }

  function clearAll() {
    onDone();
    router.push(`/transactions${withParams(new URLSearchParams(), { q: values.q || null })}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm leading-none font-medium">{t("period")}</legend>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => {
            const range = periodPreset(preset, today);
            const active = parsedFrom === range.from && parsedTo === range.to;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={active}
                onClick={() => applyPreset(preset)}
                className={cn(
                  "focus-visible:ring-ring/50 min-h-11 rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-[3px]",
                  active ? "bg-primary border-primary text-primary-foreground" : "bg-card hover:bg-muted",
                )}
              >
                {t(`presets.${preset}`)}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {([
            ["from", from, setFrom],
            ["to", to, setTo],
          ] as const).map(([name, value, set]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <Label htmlFor={`tx-${name}`}>{t(name)}</Label>
              <Input
                id={`tx-${name}`}
                inputMode="numeric"
                autoComplete="off"
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={t("datePlaceholder")}
                aria-invalid={invalid[name] || undefined}
                aria-describedby={invalid[name] ? `tx-${name}-error` : undefined}
                className="h-11 text-base md:text-sm"
              />
              {invalid[name] && (
                <p id={`tx-${name}-error`} role="alert" className="text-destructive text-xs">
                  {t("dateInvalid")}
                </p>
              )}
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tx-category">{tGlossary("category")}</Label>
        <select id="tx-category" name="category" defaultValue={values.category} className={selectClass}>
          <option value="">{t("allCategories")}</option>
          <option value="none">{tGlossary("uncategorized")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {/* "All" and "Uncategorized" stay useful without categories, so the select is kept. */}
        {categories.length === 0 && <NoCategoriesHint />}
      </div>

      {accounts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tx-account">{tGlossary("account")}</Label>
          <select id="tx-account" name="account" defaultValue={values.account} className={selectClass}>
            <option value="">{tAccounts("all")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {tags.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tx-tag">{t("tag")}</Label>
          <select id="tx-tag" name="tag" defaultValue={values.tag} className={selectClass}>
            <option value="">{t("allTags")}</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tx-min">{t("min")}</Label>
          <Input id="tx-min" name="min" inputMode="decimal" defaultValue={values.min} placeholder={t("minPlaceholder")} className="h-11 text-base md:text-sm" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tx-max">{t("max")}</Label>
          <Input id="tx-max" name="max" inputMode="decimal" defaultValue={values.max} placeholder={t("maxPlaceholder")} className="h-11 text-base md:text-sm" />
        </div>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm leading-none font-medium">{t("type")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {DIRECTIONS.map((d) => (
            <label key={d.value} className="has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-ring/50 flex min-h-11 cursor-pointer items-center justify-center rounded-md border text-sm font-medium has-[:focus-visible]:ring-[3px]">
              <input type="radio" name="direction" value={d.value} checked={direction === d.value} onChange={() => setDirection(d.value)} className="sr-only" />
              {t(d.labelKey)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tx-transfers">{t("transfers")}</Label>
        <select id="tx-transfers" name="transfers" defaultValue={values.transfers} className={selectClass}>
          <option value="">{t("transfersAll")}</option>
          <option value="hide">{t("transfersHide")}</option>
          <option value="only">{t("transfersOnly")}</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tx-ignored">{t("ignored")}</Label>
        <select id="tx-ignored" name="ignored" defaultValue={values.ignored} className={selectClass}>
          <option value="">{t("ignoredHide")}</option>
          <option value="show">{t("ignoredShow")}</option>
          <option value="only">{t("ignoredOnly")}</option>
        </select>
      </div>

      <div className="bg-card sticky bottom-0 -mx-1 flex gap-2 px-1 pt-2">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={clearAll}>
          {t("clearAll")}
        </Button>
        <Button type="submit" className="h-11 flex-1">
          {t("apply")}
        </Button>
      </div>
    </form>
  );
}
