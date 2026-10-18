import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The skeleton of `PageHeader`: same paddings and 44px height, so the title lands where the
 * skeleton's bar was. `action` draws the round button (Add, Detect now) on the right.
 */
export function PageHeaderSkeleton({
  back = false,
  action = false,
  eyebrow = false,
  titleWidth = "w-40",
  className,
}: {
  back?: boolean;
  action?: boolean;
  eyebrow?: boolean;
  titleWidth?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 pt-4 md:pt-8", className)}>
      {back && <Skeleton className="-ml-2 size-11 shrink-0 rounded-full" />}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {eyebrow && <Skeleton className="h-4 w-40" />}
        <Skeleton className={cn("h-8", titleWidth)} />
      </div>
      {action && <Skeleton className="size-11 shrink-0 rounded-full" />}
    </div>
  );
}
