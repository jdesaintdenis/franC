import { Plus } from "lucide-react";
import Link from "next/link";

/**
 * The 50 F lists' "＋ Add": a full-width button that sticks above the tab bar, where the thumb is.
 * Same `?add=1` link as the header button it replaces; the visible text is its name.
 */
export function BottomAddButton({ label, href = "?add=1" }: { label: string; href?: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      replace
      className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50 sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 mt-2 flex min-h-12 items-center justify-center gap-2 rounded-xl font-bold shadow-[0_-10px_24px_rgb(4_5_26/0.85)] outline-none focus-visible:ring-[3px] lg:bottom-6"
    >
      <Plus className="size-5" aria-hidden="true" />
      {label}
    </Link>
  );
}
