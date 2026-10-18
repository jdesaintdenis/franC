import { LoadingStatus } from "@/components/loading-status";
import { Skeleton } from "@/components/ui/skeleton";

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 border-b px-3.5 py-2.5">
      <Skeleton className="size-8 shrink-0 rounded-[10px]" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

export default function TransactionsLoading() {
  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main
        aria-busy="true"
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 pb-4 md:px-8"
      >
        <LoadingStatus />
        <div className="mt-4 flex items-center justify-between md:mt-8">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="size-11 rounded-lg" />
        </div>
        <Skeleton className="h-11 w-full" />
        <div className="flex gap-2 overflow-hidden">
          {[20, 24, 20, 16, 28].map((w, i) => (
            <Skeleton
              key={i}
              className="h-11 shrink-0 rounded-full"
              style={{ width: `${w * 4}px` }}
            />
          ))}
        </div>
        <Skeleton className="h-4 w-24" />
        {[3, 4].map((rows) => (
          <div
            key={rows}
            className="bg-card flex flex-col overflow-hidden rounded-lg border"
          >
            <div className="flex items-center justify-between border-b px-3.5 py-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
            {Array.from({ length: rows }, (_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ))}
      </main>
    </div>
  );
}
