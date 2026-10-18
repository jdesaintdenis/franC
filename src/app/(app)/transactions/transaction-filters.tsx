"use client";

import { Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { withParams } from "@/lib/transactions/filters";

const DEBOUNCE_MS = 300;

/**
 * The sticky search field. It searches as you type (URL updated 300 ms after the last key, no
 * history entry per keystroke) and still works as a plain GET form without JS: the other
 * filters travel as hidden fields, so Enter keeps them.
 */
export function TransactionSearch({
  q,
  otherParams,
  children,
}: {
  q: string;
  /** Canonical query string without `q`. */
  otherParams: string;
  /** Sits right of the field: the Filtres button. */
  children?: ReactNode;
}) {
  const t = useTranslations("transactions.filters");
  const router = useRouter();
  const [value, setValue] = useState(q);
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(q);
  const otherRef = useRef(otherParams);
  useEffect(() => {
    otherRef.current = otherParams;
  }, [otherParams]);

  // An outside navigation (clear filters, a link) changes q: follow it, unless the user is mid-typing.
  useEffect(() => {
    if (timer.current === null && valueRef.current.trim() !== q) {
      valueRef.current = q;
      setValue(q);
    }
  }, [q]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function push() {
    timer.current = null;
    const text = valueRef.current.trim();
    const href = `/transactions${withParams(new URLSearchParams(otherRef.current), { q: text === "" ? null : text })}`;
    startTransition(() => router.replace(href));
  }

  const hidden = [...new URLSearchParams(otherParams).entries()];

  // The form holds only the field: the Filters button sits beside it, not inside, because a React
  // submit event bubbles through portals and the filters sheet's own form must not reach this one.
  return (
    <div className="bg-background sticky top-0 z-20 -mx-4 px-4 py-2 md:-mx-8 md:px-8">
      <Label htmlFor="tx-q" className="sr-only">
        {t("search")}
      </Label>
      <div className="flex items-center gap-2">
        <form
          action="/transactions"
          method="get"
          className="relative min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (timer.current) clearTimeout(timer.current);
            push();
          }}
        >
          {hidden.map(([name, v]) => (
            <input key={name} type="hidden" name={name} value={v} />
          ))}
          <Search aria-hidden="true" className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            id="tx-q"
            name="q"
            type="search"
            value={value}
            onChange={(e) => {
              valueRef.current = e.target.value;
              setValue(e.target.value);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(push, DEBOUNCE_MS);
            }}
            placeholder={t("searchPlaceholder")}
            maxLength={100}
            className="h-11 pl-9 text-base md:text-sm"
          />
          {isPending && <Loader2 aria-hidden="true" className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />}
        </form>
        {children}
      </div>
      <p role="status" className="sr-only">
        {isPending ? t("searching") : ""}
      </p>
    </div>
  );
}
