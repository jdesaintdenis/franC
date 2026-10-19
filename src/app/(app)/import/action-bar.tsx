import type { ReactNode } from "react";

/** Sticky above the bottom tabs on phones so the main button stays reachable past a long page. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-col gap-1 bg-gradient-to-b from-transparent to-[#04051a]/95 to-25% px-4 pt-3 pb-2 md:-mx-8 md:px-8 lg:static lg:mx-0 lg:bg-none lg:p-0">
      {children}
    </div>
  );
}
