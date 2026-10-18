import { cn } from "@/lib/utils";

/** A soft light sweep rather than a blink; the global reduce-motion guard stops it. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "bg-accent animate-shimmer rounded-md bg-[linear-gradient(90deg,transparent_25%,color-mix(in_oklab,var(--card)_55%,transparent)_50%,transparent_75%)] bg-size-[200%_100%] bg-no-repeat",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
