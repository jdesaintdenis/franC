import type { ReactNode } from "react";

/** The engraved page title of the 50 F pages (Cinzel, spaced capitals), as the Budget page has it. */
export function PageTitle({ children }: { children: ReactNode }) {
  return <span className="font-title text-[22px] font-bold tracking-[0.1em] uppercase">{children}</span>;
}
