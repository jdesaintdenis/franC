import { LoadingStatus } from "@/components/loading-status";
import { PageHeaderSkeleton } from "@/components/page-header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Month card, then the budgets, in the page's 50 F look.
export default function BudgetLoading() {
  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main aria-busy="true" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 pb-6 md:px-8 lg:max-w-5xl">
        <LoadingStatus />
        <PageHeaderSkeleton titleWidth="w-24" />
        <div className="flex flex-col gap-2 lg:max-w-[calc(50%-12px)]">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="mt-2 h-4 w-20" />
          <div className="bg-card flex flex-col gap-4 rounded-lg border p-3.5">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-3 w-full rounded-[2px]" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
