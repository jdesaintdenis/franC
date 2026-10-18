import { useTranslations } from "next-intl";

/** Text label, so "detected" never relies on color or border style alone. */
export function DetectedBadge() {
  const t = useTranslations("recurring");
  return (
    <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-normal">{t("detected")}</span>
  );
}
