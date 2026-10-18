import { AppSidebar } from "@/components/app-sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { OfflineBanner } from "@/components/offline-banner";
import { db } from "@/db/client";
import { hasConnectedAccount } from "@/db/queries/bank-connections";
import { countToReview } from "@/db/queries/review";
import { requireUser } from "@/lib/auth/session";
import { currentDate } from "@/lib/dashboard/month";
import { ToastProvider, ToastViewport } from "@/components/toast";
import { TodayProvider } from "@/components/today-provider";

import { SyncOnOpen } from "./sync-on-open";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Authoritative auth check — proxy.ts's cookie check is optimistic only.
  const user = await requireUser();
  // One indexed count per render; review actions revalidate the layout so it stays current.
  const [reviewCount, connected] = await Promise.all([countToReview(db, user.id), hasConnectedAccount(db, user.id)]);

  return (
    <TodayProvider today={currentDate(new Date())}>
      <ToastProvider>
        {/* Pages render their own <main>, so the skip target is a plain focusable wrapper. */}
        <a
          href="#main"
          className="bg-background text-foreground focus-visible:ring-ring/50 sr-only z-[60] rounded-md border px-4 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus-visible:ring-[3px]"
        >
          Skip to content
        </a>
        <OfflineBanner />
        {/* Sidebar from 1024 px, bottom bar below; the bar's height is kept free under the content. */}
        <div className="flex flex-1">
          <AppSidebar reviewCount={reviewCount} />
          <div
            id="main"
            tabIndex={-1}
            className="flex min-w-0 flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] outline-none lg:pb-0"
          >
            {children}
          </div>
        </div>
        <BottomNav reviewCount={reviewCount} />
        {connected && <SyncOnOpen />}
        <ToastViewport />
      </ToastProvider>
    </TodayProvider>
  );
}
