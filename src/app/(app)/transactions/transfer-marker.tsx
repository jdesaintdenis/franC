import { ArrowLeftRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { DetectedBadge } from "@/app/(app)/recurring/detected-badge";
import type { TransactionListItem } from "@/db/queries/transactions";
import { cn } from "@/lib/utils";

/** Row marker for an internal transfer; detected ones also carry a text pill, never color alone. */
export function TransferMarker({ transfer }: { transfer: NonNullable<TransactionListItem["transfer"]> }) {
  const t = useTranslations("transactions.row");
  const detected = transfer.status === "detected";
  return (
    <span
      data-testid="transfer-marker"
      data-status={transfer.status}
      className={cn("text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs", detected && "italic")}
    >
      <ArrowLeftRight aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{t("transfer", { account: transfer.counterpartAccountName })}</span>
      {detected && <DetectedBadge />}
    </span>
  );
}
