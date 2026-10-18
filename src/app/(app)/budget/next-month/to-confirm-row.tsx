import { ChevronRight, CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

/** One line that says how many forecast payments are still guesses, linking to where they are confirmed. */
export function ToConfirmRow({ count }: { count: number }) {
  const t = useTranslations("plan.nextMonthPage");
  return (
    <Link
      href="/recurring"
      className="bg-card border-warning/45 hover:bg-muted/60 focus-visible:ring-ring/50 grid min-h-14 grid-cols-[40px_1fr_20px] items-center gap-3 rounded-lg border p-3 outline-none focus-visible:ring-[3px]"
    >
      <span aria-hidden="true" className="bg-warning/16 text-warning flex size-10 items-center justify-center rounded-[14px]">
        <CircleHelp className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold">{t("toConfirm", { count })}</span>
        <span className="text-muted-foreground text-xs">{t("toConfirmHint")}</span>
      </span>
      <ChevronRight className="text-muted-foreground size-5" aria-hidden="true" />
    </Link>
  );
}
