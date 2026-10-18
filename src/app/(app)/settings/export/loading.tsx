import { LoadingStatus } from "@/components/loading-status";
import { PageHeaderSkeleton } from "@/components/page-header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function ExportLoading() {
  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
    <main aria-busy="true" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-4 md:px-8">
      <LoadingStatus />
      <PageHeaderSkeleton back />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <div className="divide-y rounded-lg border">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex min-h-14 flex-col justify-center gap-1.5 px-4 py-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        ))}
      </div>
      <Skeleton className="h-4 w-3/4" />
    </main>
    </div>
  );
}
