import { cn } from "@/lib/utils";

/**
 * The "franC" logo as text: "fran" in the page's ink with the "C" in sand, the play on
 * "franÇais" (SPEC §49). Sand, never a status colour, and no red anywhere (SPEC §76).
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-foreground font-extrabold tracking-tight", className)}>
      fran<span className="text-sand">C</span>
    </span>
  );
}
