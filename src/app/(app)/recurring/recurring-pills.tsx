import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

const PILL = "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium";

/** Text pills, so a state never relies on colour or a dashed ring alone. */
export function ToConfirmPill({ className }: { className?: string }) {
  const t = useTranslations("recurring.pills");
  return <span className={cn(PILL, "bg-muted text-muted-foreground", className)}>{t("toConfirm")}</span>;
}

/** Warning colour, never red: a price rise is something to look at, not an error. */
export function PriceUpPill({ className }: { className?: string }) {
  const t = useTranslations("recurring.pills");
  return <span className={cn(PILL, "bg-warning-soft text-warning", className)}>{t("priceUp")}</span>;
}

export function CancelledPill({ className }: { className?: string }) {
  const t = useTranslations("recurring.pills");
  return <span className={cn(PILL, "bg-warning-soft text-warning", className)}>{t("cancelled")}</span>;
}
