import { LoadingStatus } from "@/components/loading-status";
import { PageHeaderSkeleton } from "@/components/page-header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Month pills, the summary card and the category rows, in the page's 50 F look.
export default function CompareLoading() {
  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main aria-busy="true" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 pb-6 md:px-8">
        <LoadingStatus />
        <PageHeaderSkeleton back titleWidth="w-40" />
        <div className="flex items-center gap-2 pb-1">
          <Skeleton className="h-12 flex-1 rounded-xl" />
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="h-12 flex-1 rounded-xl" />
        </div>
        <Skeleton className="mt-2 h-3 w-24" />
        <Skeleton className="h-52 w-full rounded-lg" />
        <Skeleton className="mt-2 h-3 w-24" />
        <div className="bg-card divide-y rounded-lg border">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3.5 py-3">
              <Skeleton className="size-8 shrink-0 rounded-[10px]" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-2 w-full" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
