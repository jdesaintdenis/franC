import { useTranslations } from "next-intl";

import { RowLink } from "@/components/row-link";

/** Line under the month card; hidden without internal transfers. */
export function TransfersNote({ count, href }: { count: number; href: string }) {
  const t = useTranslations("dashboard.totals");
  if (count === 0) return null;
  return (
    <div className="bg-card overflow-hidden rounded-lg border">
      <RowLink href={href} title={t("transfersNotCounted", { count })} />
    </div>
  );
}
