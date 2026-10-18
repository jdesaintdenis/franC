import Link from "next/link";
import { useTranslations } from "next-intl";

/** Shown instead of an empty category picker. */
export function NoCategoriesHint({ className }: { className?: string }) {
  const t = useTranslations("common");
  return (
    <p className={`text-muted-foreground text-sm ${className ?? ""}`}>
      {t.rich("noCategories", {
        import: (chunks) => (
          <Link href="/import" className="underline">
            {chunks}
          </Link>
        ),
        settings: (chunks) => (
          <Link href="/settings/categories" className="underline">
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}
