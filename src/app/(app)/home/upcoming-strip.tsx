"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { billsNear, type UpcomingBills } from "@/lib/dashboard/upcoming-bills";
import { formatDay } from "@/lib/format-date";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

// More lines than this would grow the bubble past the room reserved for it above the strip.
const BUBBLE_LINES = 3;

/**
 * The month as one line: a dot for each day that has a bill, bigger for bigger amounts, sand from
 * 100 € up. A tap on a dot names the bills of that day and its neighbours in a bubble above.
 */
export function UpcomingStrip({ upcoming, today }: { upcoming: UpcomingBills; today: string }) {
  const locale = useLocale();
  const t = useTranslations("dashboard.upcoming");
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const openDot = upcoming.dots.find((d) => d.date === open);
  const named = openDot ? billsNear(upcoming.dots, openDot.date) : [];
  const left = (position: number) => `${position * 100}%`;

  return (
    <div ref={ref}>
      <div className="relative mx-1.5 h-[72px]" data-testid="upcoming-strip">
        <div className="bg-gauge-off absolute inset-x-0 bottom-3.5 h-0.5 rounded" />
        <div className="bg-border absolute bottom-3.5 left-0 h-0.5" style={{ width: left(upcoming.todayPosition) }} />
        <div
          className="bg-primary absolute bottom-1.5 h-[18px] w-0.5 -translate-x-px rounded"
          style={{ left: left(upcoming.todayPosition) }}
        />
        {upcoming.dots.map((dot) => {
          const one = dot.bills.length === 1;
          const amount = formatCents(dot.totalCents, locale);
          const date = formatDay(dot.date, today, locale);
          return (
            <button
              key={dot.date}
              type="button"
              aria-pressed={open === dot.date}
              aria-label={one ? t("dotOne", { name: dot.bills[0].name, amount, date }) : t("dotMany", { count: dot.bills.length, amount, date })}
              onClick={() => setOpen(open === dot.date ? null : dot.date)}
              className={cn(
                "ring-card absolute bottom-[15px] -translate-x-1/2 translate-y-1/2 rounded-full ring-2 outline-none",
                "focus-visible:outline-primary focus-visible:outline-2 focus-visible:outline-offset-2",
                "after:absolute after:-inset-x-0.5 after:-inset-y-3 after:content-['']",
                dot.big ? "bg-sand" : "bg-muted-foreground",
                open === dot.date && "outline-primary outline-2 outline-offset-2",
              )}
              style={{ left: left(dot.position), width: dot.sizePx, height: dot.sizePx, zIndex: open === dot.date ? 100 : dot.sizePx }}
            />
          );
        })}
        <div role="status" aria-live="polite">
          {openDot && (
            // The tapped day's bills read in full, the neighbours' a shade fainter. The bubble's own edge follows the dot (translate by its share of the width), so it stays inside the card at both ends.
            <div
              className="bg-popover absolute bottom-[34px] z-50 flex w-max max-w-full flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-xs"
              style={{ left: left(openDot.position), transform: `translateX(-${openDot.position * 100}%)` }}
            >
              {named.slice(0, BUBBLE_LINES).map((b) => (
                <span key={`${b.id}-${b.date}`} className={cn("flex items-baseline gap-1.5", b.date !== openDot.date && "opacity-60")}>
                  <b className="truncate text-[13px]">{b.name}</b>
                  <span className="text-muted-foreground shrink-0">{`${formatCents(-b.amountCents, locale)} · ${formatDay(b.date, today, locale)}`}</span>
                </span>
              ))}
              {named.length > BUBBLE_LINES && (
                <span className="text-muted-foreground">{t("more", { count: named.length - BUBBLE_LINES })}</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="text-muted-foreground relative mx-1.5 -mt-0.5 h-3.5 text-[11px]" aria-hidden="true">
        {upcoming.todayPosition >= 0.2 && <span className="absolute left-0">1</span>}
        <span className="text-primary absolute -translate-x-1/2" style={{ left: `clamp(32px, ${left(upcoming.todayPosition)}, calc(100% - 32px))` }}>
          {t("today")}
        </span>
        {/* "1" and the last day give way to "today" at either end of the month; the label stays inside the card. */}
        {upcoming.todayPosition < 0.77 && <span className="absolute right-0">{upcoming.daysInMonth}</span>}
      </div>
    </div>
  );
}
