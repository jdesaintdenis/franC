"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { syncOnOpenAction } from "./accounts/bank/sync-action";

/**
 * Keeps bank data fresh while franC is used: when it opens, or the tab becomes visible again, the
 * server syncs imported links older than 2 hours (it re-checks, so tabs can't pile up) and the page
 * refreshes quietly when rows came in. No toast: a failure shows through the status line instead.
 */
export function SyncOnOpen() {
  const router = useRouter();
  const running = useRef(false);

  useEffect(() => {
    const run = async () => {
      if (running.current) return;
      running.current = true;
      try {
        const state = await syncOnOpenAction();
        if (state.ran && state.inserted > 0) router.refresh();
      } catch {
        // Offline or a failed call: the next open tries again.
      } finally {
        running.current = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    void run();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  return null;
}
