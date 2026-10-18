import { LoadingStatus } from "@/components/loading-status";
import { Skeleton } from "@/components/ui/skeleton";

// The import page: title, "importing into" line, the drop zone, the help line, then the history.
export default function ImportLoading() {
  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
    <main aria-busy="true" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 md:p-8">
      <LoadingStatus />
      <Skeleton className="h-8 w-28" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-5 w-40" />
      </div>
      <section className="flex flex-col gap-3">
        <Skeleton className="h-7 w-40" />
        <div className="divide-y rounded-md border">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 p-3">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-36" />
              </div>
              <Skeleton className="h-9 w-20" />
            </div>
          ))}
        </div>
      </section>
    </main>
    </div>
  );
}
