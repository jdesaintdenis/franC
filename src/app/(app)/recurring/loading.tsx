import { LoadingStatus } from "@/components/loading-status";
import { PageHeaderSkeleton } from "@/components/page-header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="mx-1 h-4 w-28" />
      <div className="bg-card divide-y overflow-hidden rounded-lg border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-8 shrink-0 rounded-[10px]" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RecurringLoading() {
  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main aria-busy="true" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-4 md:px-8">
        <LoadingStatus />
        <PageHeaderSkeleton back action titleWidth="w-52" />
        <div className="bg-card flex flex-col gap-1 rounded-lg border p-3.5">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <SectionSkeleton rows={3} />
        <SectionSkeleton rows={4} />
      </main>
    </div>
  );
}
