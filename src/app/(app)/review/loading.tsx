import { LoadingStatus } from "@/components/loading-status";
import { PageHeaderSkeleton } from "@/components/page-header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Header with a back arrow, the "Mark all" row, then one review card.
export default function ReviewLoading() {
  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main
        aria-busy="true"
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-4 md:px-8"
      >
        <LoadingStatus />
        <PageHeaderSkeleton back titleWidth="w-36" />
        <div className="flex gap-2">
          <Skeleton className="h-11 w-36 rounded-md" />
          <Skeleton className="h-11 w-28 rounded-md" />
        </div>
        <div className="bg-card flex flex-col gap-4 rounded-lg border p-3.5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 shrink-0 rounded-[10px]" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-20" />
          </div>
          <Skeleton className="h-11 w-full rounded-md" />
          <div className="flex gap-2">
            <Skeleton className="h-11 flex-1 rounded-md" />
            <Skeleton className="h-11 w-24 rounded-md" />
          </div>
        </div>
      </main>
    </div>
  );
}
