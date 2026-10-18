import { LoadingStatus } from "@/components/loading-status";
import { PageHeaderSkeleton } from "@/components/page-header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

function CardRows({ rows, title = true }: { rows: number; title?: boolean }) {
  return (
    <div className="bg-card flex flex-col gap-3 rounded-lg border p-3.5">
      {title && <Skeleton className="h-6 w-36" />}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-[10px]" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}

// Home's shape, in Home's order: header, hero, Needs attention, then the accounts and budgets
// lists (a second column from lg). A segment's loading.tsx cannot target only page.tsx, so any
// page without a skeleton of its own falls back to this; every page is 50 F, so it is too.
export default function AppLoading() {
  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main
        aria-busy="true"
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-4 md:px-8 lg:max-w-5xl"
      >
        <LoadingStatus />
        <PageHeaderSkeleton eyebrow titleWidth="w-28" />
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-64 w-full rounded-lg" />
            <CardRows rows={2} />
          </div>
          <div className="flex flex-col gap-4">
            <CardRows rows={2} />
            <CardRows rows={2} />
          </div>
        </div>
      </main>
    </div>
  );
}
