import { useTranslations } from "next-intl";

/** Announces loading to screen readers; the skeletons around it are decorative. */
export function LoadingStatus() {
  const t = useTranslations("common.actions");
  return (
    <p role="status" className="sr-only">
      {t("loading")}
    </p>
  );
}
