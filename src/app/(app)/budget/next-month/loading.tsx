import { LoadingStatus } from "@/components/loading-status";
import { PageHeaderSkeleton } from "@/components/page-header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

function ListCard({ rows }: { rows: number }) {
  return (
    <>
      <Skeleton className="mt-2 h-3 w-24" />
      <div className="bg-card divide-y rounded-lg border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-2.5 px-3.5 py-2.5">
            <Skeleton className="size-8 shrink-0 rounded-[10px]" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </>
  );
}

// What's left card, then the payments and income lists, in the page's 50 F look.
export default function NextMonthLoading() {
  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main aria-busy="true" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 pb-6 md:px-8 lg:max-w-5xl">
        <LoadingStatus />
        <PageHeaderSkeleton back eyebrow titleWidth="w-40" />
        <Skeleton className="mt-2 h-3 w-24" />
        <Skeleton className="h-52 w-full rounded-lg" />
        <ListCard rows={4} />
        <ListCard rows={2} />
      </main>
    </div>
  );
}
