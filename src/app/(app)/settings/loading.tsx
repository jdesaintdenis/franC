import { LoadingStatus } from "@/components/loading-status";
import { PageHeaderSkeleton } from "@/components/page-header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// The Plus tab: four short cards of rows. Each Settings sub-page has its own `loading.tsx`.
export default function SettingsLoading() {
  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main aria-busy="true" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 pb-6 md:px-8">
        <LoadingStatus />
        <PageHeaderSkeleton titleWidth="w-24" />
        {[5, 1, 1, 1].map((rows, i) => (
          <section key={i} className="flex flex-col gap-2">
            <Skeleton className="mt-2 h-3 w-24" />
            <div className="bg-card divide-y overflow-hidden rounded-lg border">
              {Array.from({ length: rows }, (_, j) => (
                <div key={j} className="flex min-h-[52px] items-center gap-3 px-3.5">
                  <Skeleton className="size-8 shrink-0 rounded-[10px]" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
