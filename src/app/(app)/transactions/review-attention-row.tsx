import { ChevronRight, ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

/** The "N à valider" row above the list: one tap filters the list to those rows (SPEC §73 G). */
export function ReviewAttentionRow({ count, href }: { count: number; href: string }) {
  const t = useTranslations("transactions.list");
  return (
    <Link
      href={href}
      data-testid="review-attention"
      className="bg-card focus-visible:ring-ring/50 flex min-h-11 items-center gap-3 rounded-lg border p-3 outline-none focus-visible:ring-[3px]"
    >
      <span aria-hidden="true" className="bg-warning-soft text-warning flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5">
        <ListChecks />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold break-words">{t("attentionTitle", { count })}</span>
        <span className="text-muted-foreground text-xs break-words">{t("attentionHint")}</span>
      </span>
      <ChevronRight aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
    </Link>
  );
}
