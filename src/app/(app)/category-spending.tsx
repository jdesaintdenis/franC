"use client";

import { useState, type ReactNode } from "react";
import { ChartPie, ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, type PieSectorShapeProps } from "recharts";

import { CENTER_LABEL_CLASSES } from "@/components/charts/chart-style";
import { useChartSelection } from "@/components/charts/use-chart-selection";
import { CategoryMarker } from "@/components/category-marker";
import { EmptyState } from "@/components/empty-state";
import { categoryDisplayColor } from "@/lib/category-color";
import { percentShares } from "@/lib/dashboard/shares";
import { formatCents, formatWholeCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { CategoryDetailCard } from "./category-detail-card";
import { HomeSection } from "./home/home-section";
import { useShareLabel } from "./share-label";

export interface SubcategorySlice {
  key: string;
  name: string;
  color: string;
  icon: string | null;
  spentCents: number;
}

export interface CategorySlice {
  key: string;
  name: string;
  color: string;
  icon: string | null;
  spentCents: number;
  href: string;
  /** Present when part of the category's spending was filed on its subcategories. */
  subcategories?: SubcategorySlice[];
}

const RADIAN = Math.PI / 180;
const PULL_OUT_PX = 6;
/** Rows shown before "All categories (N)" on the Budget page. */
export const CATEGORY_ROWS_SHOWN = 4;

/** The Budget page's own links (the subcategory breakdown) keep the scroll; links to another page open at its top. */
export function staysOnPage(href: string): boolean {
  return href.startsWith("/budget?");
}

export function CategorySpending({
  slices,
  totalCents,
  heading,
  shareOf,
  visibleCount,
  aside,
}: {
  slices: CategorySlice[];
  totalCents: number;
  /** Overrides the default title, e.g. for a subcategory breakdown. */
  heading?: string;
  /** The parent's name on a subcategory breakdown, so shares read "32% of Housing". */
  shareOf?: string;
  /** Rows shown before "See all categories"; every row when omitted (the breakdown page). */
  visibleCount?: number;
  /** A control beside the title (the Year page's period button). */
  aside?: ReactNode;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard.categorySpending");
  const glossary = useTranslations("common.glossary");
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  const shareLabel = useShareLabel();
  const title = heading ?? t("heading");

  // Mouse hover and keyboard focus are transient; a touch selection sticks until cleared.
  const selection = useChartSelection<string>();
  const { selectedKey, activeKey, attachContainer, setHoverKey } = selection;

  const shares = percentShares(slices.map((s) => s.spentCents));
  const activeIndex = slices.findIndex((s) => s.key === activeKey);
  const active = activeIndex >= 0 ? slices[activeIndex] : undefined;

  function renderSlice(props: PieSectorShapeProps) {
    const { index, cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, stroke, strokeWidth } = props;
    const slice = slices[index];
    const isActive = index === activeIndex;
    const midRadius = (innerRadius + outerRadius) / 2;
    const mid = ((startAngle + endAngle) / 2) * RADIAN;
    return (
      <g data-slice-name={slice?.name}>
        {/* Geometry only: spreading `props` would copy the slice's data (href, icon…) onto the path. */}
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={isActive ? outerRadius + PULL_OUT_PX : outerRadius}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        {/* Invisible: marks the middle of the slice, a safe place to tap whatever its size. */}
        <circle data-slice-anchor="" cx={cx + midRadius * Math.cos(-mid)} cy={cy + midRadius * Math.sin(-mid)} r={1} fill="none" pointerEvents="none" />
      </g>
    );
  }

  const maxSpent = Math.max(1, ...slices.map((s) => s.spentCents));

  return (
    <HomeSection headingId="category-spending-heading" title={title} aside={aside} testId="category-spending">
      {slices.length === 0 || totalCents <= 0 ? (
        <EmptyState compact headingLevel="h3" icon={ChartPie} title={t("empty")} className="px-0" />
      ) : (
        <div className="flex flex-col gap-3">
          <div ref={attachContainer} className="grid gap-3">
            {/* Decorative: the list below carries the same data accessibly. */}
            <div
              className="relative h-56 w-full"
              aria-hidden="true"
              data-testid="category-chart"
              {...selection.chartProps}
            >
              <ResponsiveContainer width="100%" height={224}>
                <PieChart accessibilityLayer={false}>
                  <Pie
                    data={slices}
                    dataKey="spentCents"
                    nameKey="name"
                    innerRadius="58%"
                    outerRadius="90%"
                    stroke="var(--card)"
                    strokeWidth={2}
                    isAnimationActive={false}
                    // The wrapper is aria-hidden: nothing inside may take focus (axe aria-hidden-focus).
                    rootTabIndex={-1}
                    shape={renderSlice}
                    onMouseEnter={(_, index) => selection.hover(slices[index]?.key ?? null)}
                    onMouseLeave={() => selection.hover(null)}
                    // On touch a tap only selects, so a slip of the finger never navigates.
                    onClick={(_, index, event) => {
                      const slice = slices[index];
                      if (slice) selection.itemClick(slice.key, event, () => router.push(slice.href, { scroll: !staysOnPage(slice.href) }));
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    {slices.map((s) => (
                      <Cell key={s.key} fill={categoryDisplayColor(s.color)} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {/* The total sits in the donut's hole; the list below carries the same numbers. */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className={CENTER_LABEL_CLASSES.caption}>{glossary("spent")}</span>
                <span className={CENTER_LABEL_CLASSES.value}>{formatWholeCents(totalCents, locale)}</span>
              </div>
            </div>
            {active ? (
              <CategoryDetailCard
                slice={active}
                share={shares[activeIndex] ?? 0}
                shareOf={shareOf}
                onClose={selectedKey ? selection.clear : undefined}
              />
            ) : null}
          </div>
          <ul className="divide-border -my-1 divide-y text-sm">
            {slices.map((s, i) =>
              visibleCount !== undefined && !expanded && i >= visibleCount ? null : (
              <li key={s.key}>
                <Link
                  href={s.href}
                  scroll={!staysOnPage(s.href)}
                  aria-current={s.key === activeKey ? "true" : undefined}
                  className={cn(
                    "focus-visible:ring-ring/50 -mx-1 grid grid-cols-[32px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 rounded-md px-1 py-3 outline-none focus-visible:ring-[3px]",
                    s.key === activeKey && "bg-accent",
                  )}
                  // Keyboard focus only: a click also focuses the link, and a card appearing above
                  // the list on a narrow screen would move the row out from under the pointer.
                  onFocus={(e) => {
                    if (e.currentTarget.matches(":focus-visible")) setHoverKey(s.key);
                  }}
                  onBlur={() => setHoverKey(null)}
                >
                  <span
                    aria-hidden="true"
                    className="row-span-2 flex size-8 items-center justify-center rounded-[10px] text-lg"
                    style={{ backgroundColor: `color-mix(in srgb, ${categoryDisplayColor(s.color)} 18%, transparent)` }}
                  >
                    <CategoryMarker icon={s.icon} color={s.color} />
                  </span>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className={cn("min-w-0 flex-1 truncate font-semibold", s.key === "none" && "text-warning")}>
                      {s.name}
                      {s.subcategories && s.subcategories.length > 0 && (
                        <span className="sr-only">
                          {", "}
                          {t("subcategorySummary", { list: subcategorySummary(s.subcategories, shareLabel) })}
                        </span>
                      )}
                    </span>
                    <span className="font-semibold tabular-nums">{formatCents(s.spentCents, locale)}</span>
                    <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">{shareLabel(s.spentCents, shares[i] ?? 0)}</span>
                  </span>
                  <span aria-hidden="true" className="bg-gauge-off h-1.5 overflow-hidden rounded-[3px]">
                    <span
                      className="block h-full rounded-[3px]"
                      style={{ width: `${Math.max(2, (s.spentCents / maxSpent) * 100)}%`, backgroundColor: categoryDisplayColor(s.color) }}
                    />
                  </span>
                </Link>
              </li>
              ),
            )}
          </ul>
          {visibleCount !== undefined && slices.length > visibleCount && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((e) => !e)}
              className="text-primary hover:bg-muted/60 focus-visible:ring-ring/50 -mx-3.5 -mb-3.5 flex min-h-12 items-center justify-between gap-3 border-t px-3.5 text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
            >
              <span>{expanded ? t("showFewer") : t("seeAllCount", { count: slices.length })}</span>
              <ChevronDown className={cn("size-5 shrink-0 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </HomeSection>
  );
}

function subcategorySummary(subs: SubcategorySlice[], shareLabel: (cents: number, share: number) => string) {
  const shares = percentShares(subs.map((s) => s.spentCents));
  return subs.map((s, i) => `${s.name} ${shareLabel(s.spentCents, shares[i] ?? 0)}`).join(", ");
}
