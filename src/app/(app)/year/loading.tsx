import { LoadingStatus } from "@/components/loading-status";
import { PageHeaderSkeleton } from "@/components/page-header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

function Card({ className }: { className: string }) {
  return (
    <>
      <Skeleton className="mt-2 h-3 w-24" />
      <Skeleton className={`w-full rounded-lg ${className}`} />
    </>
  );
}

// Header, the year bar, then the headline, the monthly bars and the list, in the page's 50 F look.
export default function YearLoading() {
  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main aria-busy="true" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 pb-6 md:px-8 lg:max-w-5xl">
        <LoadingStatus />
        <PageHeaderSkeleton back titleWidth="w-24" />
        <Skeleton className="h-[54px] w-full rounded-lg" />
        <Card className="h-44" />
        <Card className="h-44" />
        <Card className="h-64" />
      </main>
    </div>
  );
}
