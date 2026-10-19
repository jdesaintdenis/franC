import { ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";

import { CategoryMarker } from "@/components/category-marker";
import { formatMonthName, inSentence } from "@/lib/dashboard/month";
import { formatShortDay } from "@/lib/format-date";
import { formatCents, formatSignedCents } from "@/lib/money";
import type { SafeToSpendResult } from "@/lib/safe-to-spend/compute";
import { cn } from "@/lib/utils";

import { DetectedBadge } from "./recurring/detected-badge";

export function settingsLink(href: string) {
  return function SettingsLink(chunks: React.ReactNode) {
    return (
      <Link href={href} className="text-foreground underline underline-offset-2">
        {chunks}
      </Link>
    );
  };
}

// The same two looks as the budget gauges: hatched = expected or set aside, solid = counted now.
const HELD_STYLE = {
  background: "repeating-linear-gradient(135deg, var(--primary) 0 2px, transparent 2px 6px)",
  boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--primary) 60%, transparent)",
} as const;
const DUE_STYLE = {
  background: "repeating-linear-gradient(135deg, var(--sand) 0 2px, transparent 2px 6px)",
  boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--sand) 70%, transparent)",
} as const;

type Part = "held" | "bills" | "budgets" | "left";

/** The look of a part, shared by the split bar and the swatch on its line so the bar needs no legend. */
function partProps(part: Part): { className?: string; style?: React.CSSProperties } {
  if (part === "held") return { style: HELD_STYLE };
  if (part === "bills") return { style: DUE_STYLE };
  return { className: part === "budgets" ? "bg-primary" : "bg-sand" };
}

function Swatch({ part }: { part: Part }) {
  const { className, style } = partProps(part);
  return <span aria-hidden="true" className={cn("size-3 shrink-0 rounded-[3px]", className)} style={style} />;
}

/** One line of the receipt: a plain row, or a fold (native <details>) when it has a list under it. */
function ReceiptRow({
  sign,
  part,
  label,
  amount,
  amountClassName,
  open,
  children,
}: {
  sign?: string;
  part?: Part;
  label: ReactNode;
  amount: string;
  amountClassName?: string;
  open?: boolean;
  children?: ReactNode;
}) {
  const head = (
    <>
      <span className="text-muted-foreground w-[18px] shrink-0 text-center font-bold">{sign}</span>
      {part ? <Swatch part={part} /> : <span className="size-3 shrink-0" />}
      <span className="min-w-0 flex-1 font-semibold">{label}</span>
      <span className={cn("shrink-0 font-semibold tabular-nums", amountClassName)}>{amount}</span>
    </>
  );
  const rowClass = "flex min-h-12 items-center gap-2.5 px-3.5";
  if (!children) {
    return (
      <div className={rowClass}>
        {head}
        <span className="size-[18px] shrink-0" />
      </div>
    );
  }
  return (
    <details open={open} className="group">
      <summary
        className={cn(
          rowClass,
          "hover:bg-muted/60 focus-visible:ring-ring/50 cursor-pointer list-none outline-none focus-visible:ring-[3px] focus-visible:ring-inset [&::-webkit-details-marker]:hidden",
        )}
      >
        {head}
        <ChevronDown className="text-muted-foreground size-[18px] shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="text-muted-foreground flex flex-col gap-1.5 pr-3.5 pb-3 pl-16 text-[13px]">{children}</div>
    </details>
  );
}

function SubLine({ children, amount, muted }: { children: ReactNode; amount: string; muted?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", muted && "opacity-80")}>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 break-words">{children}</span>
      <span className="shrink-0 tabular-nums">{amount}</span>
    </div>
  );
}

/**
 * The safe-to-spend arithmetic, with cents: a summary card (the amount and a bar showing what the
 * balance is split into), then a receipt whose lists open and close. Server-rendered and shown inside
 * the hero's sheet; the folds are native <details>, so nothing here needs client code.
 */
export function SafeToSpendBreakdown({ result, today }: { result: SafeToSpendResult; today: string }) {
  const locale = useLocale();
  const t = useTranslations("dashboard.safeToSpend");
  const holds = result.incomeMonth === "next";
  const month = inSentence(formatMonthName(result.nextMonth, locale), locale);
  const negative = result.safeCents < 0;
  const countedIncome = result.income.filter((i) => i.countsNow);
  const expectedLater = result.income.filter((i) => !i.countsNow);
  const showIncome = countedIncome.length > 0 || result.ignoredDetectedIncomeCount > 0;

  const parts: { part: Part; cents: number }[] = [
    { part: "held", cents: result.heldCents },
    { part: "bills", cents: result.billsCents },
    { part: "budgets", cents: result.budgetsLeftCents },
    { part: "left", cents: Math.max(0, result.safeCents) },
  ];
  const shown = parts.filter((p) => p.cents > 0);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="bg-card flex flex-col gap-3 rounded-[10px] border p-3.5">
        <div>
          <div className="text-muted-foreground text-[13px]">{t("result")}</div>
          <div
            data-testid="breakdown-result"
            className={cn("text-4xl leading-[1.05] font-bold tabular-nums", negative ? "text-warning" : "text-sand")}
          >
            {formatCents(result.safeCents, locale)}
          </div>
        </div>
        {shown.length > 0 && (
          <div aria-hidden="true" className="flex h-3.5 gap-0.5 overflow-hidden rounded-[4px]">
            {shown.map(({ part, cents }) => {
              const { className, style } = partProps(part);
              return <i key={part} className={cn("block h-full", className)} style={{ flexGrow: cents, flexBasis: 0, ...style }} />;
            })}
          </div>
        )}
      </div>

      <div className="bg-card divide-y overflow-hidden rounded-[10px] border">
        <ReceiptRow label={t("balance")} amount={formatCents(result.balanceCents, locale)} />

        {holds && (
          <ReceiptRow
            sign="−"
            part="held"
            label={t("held", { month })}
            amount={formatSignedCents(-result.heldCents, locale)}
            open={result.heldForNextMonth.length > 0}
          >
            {result.heldForNextMonth.length === 0 && expectedLater.length === 0 ? (
              <p>{t("heldNone")}</p>
            ) : (
              <>
                {result.heldForNextMonth.map((r) => (
                  <SubLine key={r.id} amount={formatSignedCents(r.amountCents, locale)}>
                    {`${r.label} · ${formatShortDay(r.date, today, locale)}`}
                  </SubLine>
                ))}
                {expectedLater.map((i) => (
                  <SubLine key={`${i.id}-${i.date}`} amount={formatCents(i.amountCents, locale)} muted>
                    {t("expectedNextMonth", { name: i.name, date: formatShortDay(i.date, today, locale), month })}
                  </SubLine>
                ))}
              </>
            )}
          </ReceiptRow>
        )}

        {showIncome && (
          <ReceiptRow sign="+" label={t("income")} amount={formatSignedCents(result.incomeCents, locale)}>
            {countedIncome.map((i) => (
              <SubLine key={`${i.id}-${i.date}`} amount={formatSignedCents(i.amountCents, locale)}>
                {`${i.name} · ${formatShortDay(i.date, today, locale)}`}
              </SubLine>
            ))}
            {result.ignoredDetectedIncomeCount > 0 && (
              <p>
                {t.rich("ignoredIncome", {
                  count: result.ignoredDetectedIncomeCount,
                  link: settingsLink("/recurring"),
                })}
              </p>
            )}
          </ReceiptRow>
        )}

        <ReceiptRow
          sign="−"
          part="bills"
          label={t("bills", { count: result.bills.length })}
          amount={formatSignedCents(-result.billsCents, locale)}
        >
          {result.bills.length === 0 ? (
            <p>{t("noBills")}</p>
          ) : (
            result.bills.map((b) => (
              <SubLine key={`${b.id}-${b.date}`} amount={formatSignedCents(b.amountCents, locale)}>
                <span className="break-words">{`${b.name} · ${formatShortDay(b.date, today, locale)}`}</span>
                {b.status === "detected" && <DetectedBadge />}
              </SubLine>
            ))
          )}
        </ReceiptRow>

        <ReceiptRow
          sign="−"
          part="budgets"
          label={t("budgets", { count: result.budgets.length })}
          amount={formatSignedCents(-result.budgetsLeftCents, locale)}
        >
          {result.budgets.length === 0 ? (
            <p>{t.rich("noBudgets", { link: settingsLink("/settings/budgets") })}</p>
          ) : (
            result.budgets.map((b) => (
              <SubLine key={b.categoryId} amount={formatCents(b.reservedCents, locale)}>
                <CategoryMarker icon={b.icon} color={b.color} className="size-2.5" />
                <span className="break-words">
                  {b.parentName ? `${b.parentName} > ${b.name}` : b.name}
                  {b.billsCents > 0 && ` (${t("includesBills", { amount: formatCents(b.billsCents, locale) })})`}
                </span>
              </SubLine>
            ))
          )}
        </ReceiptRow>

        <ReceiptRow
          sign="="
          part="left"
          label={<span className="font-bold">{t("result")}</span>}
          amount={formatCents(result.safeCents, locale)}
          amountClassName={cn("text-lg font-bold", negative ? "text-warning" : "text-sand")}
        />
      </div>

      {holds && (
        <p className="bg-card text-muted-foreground rounded-[10px] border p-3.5 text-xs leading-relaxed">
          {t("heldHint", { month })}{" "}
          <Link href="/settings" className="text-primary inline-flex items-center font-bold whitespace-nowrap">
            {t("heldSettings")}
          </Link>
        </p>
      )}
    </div>
  );
}
