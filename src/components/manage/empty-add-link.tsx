import { Plus } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

/** The empty state's primary action: same `?add=1` link as the header's Add button. */
export function EmptyAddLink({ label, href = "?add=1" }: { label: string; href?: string }) {
  return (
    <Link href={href} scroll={false} replace className={buttonVariants({ className: "h-11" })}>
      <Plus className="size-5" aria-hidden="true" />
      {label}
    </Link>
  );
}
