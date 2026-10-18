"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";

import { listBanksAction, type BankOption } from "./actions";

type Banks = { status: "idle" | "loading" } | { status: "ok"; banks: BankOption[] } | { status: "error"; error: string };

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr");

/**
 * "Choose your bank": the list comes from Enable Banking when the sheet opens. Each bank is a plain
 * link to the connect route, which redirects to the bank's own login page.
 */
export function BankPickerSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("settings.bankConnection.picker");
  const [banks, setBanks] = useState<Banks>({ status: "idle" });
  const [query, setQuery] = useState("");

  const load = () => {
    setBanks({ status: "loading" });
    listBanksAction()
      .then(setBanks)
      .catch(() => setBanks({ status: "error", error: t("failed") }));
  };

  const shown = useMemo(() => {
    if (banks.status !== "ok") return [];
    const q = fold(query.trim());
    return q ? banks.banks.filter((b) => fold(b.name).includes(q)) : banks.banks;
  }, [banks, query]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="theme-50f"
        title={t("title")}
        description={t("search")}
        // Loaded the first time the sheet opens, then kept for the page view.
        onOpenAutoFocus={() => {
          if (banks.status === "idle" || banks.status === "error") load();
        }}
      >
        <div className="flex flex-col gap-3">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
          />
          {banks.status === "loading" || banks.status === "idle" ? (
            <p role="status" className="text-muted-foreground py-4 text-center text-sm">
              {t("loading")}
            </p>
          ) : banks.status === "error" ? (
            <div className="flex flex-col items-center gap-2 py-4">
              <p role="alert" className="text-sm">
                {banks.error}
              </p>
              <Button type="button" variant="outline" onClick={load}>
                {t("retry")}
              </Button>
            </div>
          ) : shown.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">{t("none", { query: query.trim() })}</p>
          ) : (
            <ul aria-label={t("listLabel")} className="bg-card divide-border divide-y overflow-hidden rounded-[10px] border">
              {shown.map((bank) => (
                <li key={`${bank.country}:${bank.name}`}>
                  {/* A full navigation, not next/link: it must never be prefetched (it starts a login). */}
                  <a
                    href={`/api/bank-sync/connect?${new URLSearchParams({ aspsp: bank.name, country: bank.country })}`}
                    className="hover:bg-muted focus-visible:ring-ring/50 flex min-h-[52px] items-center gap-3 px-3.5 py-2 outline-none focus-visible:ring-[3px]"
                  >
                    <span className="flex-1 font-semibold wrap-anywhere">{bank.name}</span>
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-xs">{t("description")}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
