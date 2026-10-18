import { LoadingStatus } from "@/components/loading-status";
import { PageHeaderSkeleton } from "@/components/page-header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

function RowSkeleton({ marker, bar }: { marker: boolean; bar: boolean }) {
  return (
    <div className="flex min-h-14 items-center gap-3 py-2.5 pr-3 pl-4">
      {marker && <Skeleton className={"size-8 shrink-0 rounded-[10px]"} />}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-2/5" />
        {bar ? (
          <Skeleton className="h-2 w-full rounded-full" />
        ) : (
          <Skeleton className="h-3 w-1/4" />
        )}
      </div>
      <Skeleton className="size-6 shrink-0 rounded-full" />
    </div>
  );
}

/**
 * The loading shape of every Settings list (Categories, Rules, Tags, Merchants, Goals,
 * Accounts, Bank categories, Budgets): header with a round Add button, an optional intro line,
 * then rows in a card (night wrapper, tile markers) of marker, name, caption and the "⋯" menu. Same container as the pages.
 */
export function ManageListSkeleton({
  intro = 2,
  add = true,
  markers = true,
  bars = false,
  rows = 6,
}: {
  /** Lines of intro text under the header; 0 for none. */
  intro?: number;
  add?: boolean;
  markers?: boolean;
  /** Budgets: a thin progress bar instead of the caption. */
  bars?: boolean;
  rows?: number;
}) {
  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main
        aria-busy="true"
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-4 md:px-8"
      >
        <LoadingStatus />
        <PageHeaderSkeleton back action={add} />
        {intro > 0 && (
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: intro }, (_, i) => (
              <Skeleton
                key={i}
                className={
                  i === intro - 1 && intro > 1 ? "h-4 w-4/5" : "h-4 w-full"
                }
              />
            ))}
          </div>
        )}
        <div className={"bg-card divide-y rounded-lg border"}>
          {Array.from({ length: rows }, (_, i) => (
            <RowSkeleton key={i} marker={markers} bar={bars} />
          ))}
        </div>
      </main>
    </div>
  );
}
