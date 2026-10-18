import { Check, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

import type { WelcomeSteps, WelcomeStepKey } from "@/lib/dashboard/welcome";
import { cn } from "@/lib/utils";

import { HomeSection } from "./home/home-section";
import { hideWelcomeAction } from "./welcome-actions";

const HREF: Record<WelcomeStepKey, string> = {
  bank: "/accounts/bank",
  import: "/import",
  review: "/review",
  balance: "/accounts",
  budget: "/settings/budgets?add=1",
};

/** First-run checklist: a gauge and the steps in order, the next undone one highlighted. */
export async function WelcomeChecklist({ welcome }: { welcome: WelcomeSteps }) {
  const t = await getTranslations("dashboard.welcome");
  const bankSync = welcome.steps.some((s) => s.key === "bank");
  return (
    <div className="flex flex-col gap-2">
      <HomeSection
        headingId="welcome-heading"
        title={t("title")}
        note={t("progress", { done: welcome.doneCount, total: welcome.steps.length })}
        testId="welcome-checklist"
      >
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-4 gap-[3px]" aria-hidden="true">
            {welcome.steps.map(({ key, done }) => (
              <i key={key} className={cn("h-2 rounded-[2px]", done ? "bg-positive" : "bg-gauge-off")} />
            ))}
          </div>
          <ol className="divide-border divide-y">
            {welcome.steps.map(({ key, done }) => {
              const next = key === welcome.nextKey;
              const hint = key === "balance" && bankSync ? t("steps.balance.hintBank") : t(`steps.${key}.hint`);
              return (
                <li key={key} className="flex flex-col">
                  <Link
                    href={HREF[key]}
                    data-testid={`welcome-step-${key}`}
                    data-done={done}
                    aria-current={next ? "step" : undefined}
                    className="focus-visible:ring-ring/50 grid min-h-14 grid-cols-[24px_1fr_16px] items-center gap-3 py-2 outline-none focus-visible:ring-[3px]"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full border-2",
                        done ? "bg-positive border-positive text-background" : next ? "border-primary" : "border-input",
                      )}
                    >
                      {done && <Check className="size-3.5" strokeWidth={3} />}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className={cn("break-words", done ? "text-muted-foreground" : next ? "text-primary font-bold" : "font-semibold")}>
                        {t(`steps.${key}.title`)}
                      </span>
                      {!done && <span className="text-muted-foreground text-xs break-words">{hint}</span>}
                    </span>
                    <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
                  </Link>
                  {key === "bank" && !done && (
                    <Link href="/import" className="text-primary -mt-1.5 min-h-10 self-start pl-9 text-[13px] font-semibold">
                      {t("steps.bank.alt")}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </HomeSection>
      <form action={hideWelcomeAction}>
        <button
          type="submit"
          data-testid="welcome-hide"
          className="text-muted-foreground focus-visible:ring-ring/50 inline-flex min-h-10 items-center rounded-md px-1 text-[13px] outline-none focus-visible:ring-[3px]"
        >
          {t("hide")}
        </button>
      </form>
    </div>
  );
}
