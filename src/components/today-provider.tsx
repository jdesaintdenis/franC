"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { currentDate } from "@/lib/dashboard/month";

const TodayContext = createContext<string | null>(null);

/**
 * The user's current date ("YYYY-MM-DD", Europe/Paris) for client components
 * that write "Today" / "Yesterday". The server's value keeps hydration stable;
 * it is refreshed when the app comes back to the foreground, because the
 * layout isn't re-rendered on navigation and a PWA can stay open overnight.
 */
export function TodayProvider({ today, children }: { today: string; children: React.ReactNode }) {
  const [value, setValue] = useState(today);
  useEffect(() => {
    const refresh = () => setValue(currentDate(new Date()));
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);
  return <TodayContext.Provider value={value}>{children}</TodayContext.Provider>;
}

/** Outside a provider (tests, public pages) it falls back to the date now. */
export function useToday(): string {
  return useContext(TodayContext) ?? currentDate(new Date());
}
