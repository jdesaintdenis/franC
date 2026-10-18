"use client";

import { useCallback, useSyncExternalStore } from "react";

const DEFAULT_KEY = "franc:transactions-swipe-hint-dismissed";
const listeners = new Set<() => void>();
// Fallback when localStorage is blocked: the hint still goes away for this page view.
const dismissedInMemory = new Set<string>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readSnapshot(key: string): boolean {
  if (dismissedInMemory.has(key)) return false;
  try {
    return localStorage.getItem(key) !== "1";
  } catch {
    return true;
  }
}

// False on the server and during hydration, so the markup matches; the real value arrives after mount.
function getServerSnapshot(): boolean {
  return false;
}

/** The one-time "swipe a row" tip: visible until the first swipe or the dismiss button. */
export function useSwipeHint(key: string = DEFAULT_KEY) {
  const getSnapshot = useCallback(() => readSnapshot(key), [key]);
  const visible = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const dismiss = useCallback(() => {
    dismissedInMemory.add(key);
    try {
      localStorage.setItem(key, "1");
    } catch {
      // Private mode or blocked storage: the in-memory flag is enough.
    }
    listeners.forEach((listener) => listener());
  }, [key]);
  return { visible, dismiss };
}
