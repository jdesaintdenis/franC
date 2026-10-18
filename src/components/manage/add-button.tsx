import { Plus } from "lucide-react";
import Link from "next/link";

/**
 * The header's "＋ Add": a link to `?add=1`, which the screen reads to open its add sheet.
 * The label stays visible from `sm`; below, the button is icon-only with the same name.
 */
export function AddButton({ label, href = "?add=1" }: { label: string; href?: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      replace
      aria-label={label}
      className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50 flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 font-semibold outline-none focus-visible:ring-[3px] sm:px-4"
    >
      <Plus className="size-5" aria-hidden="true" />
      <span className="max-sm:sr-only" aria-hidden="true">
        {label}
      </span>
    </Link>
  );
}
