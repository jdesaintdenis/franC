"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { z } from "zod";

// `?amount=<cents>` pre-fills a new item's amount (a regular payment opening its category's budget).
const amountParam = z.coerce.number().int().positive().max(100_000_000);

/**
 * Which management sheet is open lives in the URL (`?add=1`, `?edit=<id>`), so other screens
 * can link straight to it, with `&amount=<cents>` to pre-fill a new item. Changes replace the
 * entry: closing a sheet is not a "back" step.
 */
export function useSheetParam() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const adding = params.get("add") === "1";
  const editing = params.get("edit");
  const amount = amountParam.safeParse(params.get("amount") ?? undefined);
  const amountCents = amount.success ? amount.data : null;

  const set = useCallback(
    (next: { add?: boolean; edit?: string | null }) => {
      const search = new URLSearchParams(params.toString());
      search.delete("add");
      search.delete("edit");
      search.delete("amount");
      if (next.add) search.set("add", "1");
      if (next.edit) search.set("edit", next.edit);
      const query = search.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return {
    adding,
    editing,
    amountCents,
    openAdd: useCallback(() => set({ add: true }), [set]),
    openEdit: useCallback((id: string) => set({ edit: id }), [set]),
    close: useCallback(() => set({}), [set]),
  };
}
