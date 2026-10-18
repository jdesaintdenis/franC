"use client";

import { ChevronRight, Clock, Eye, FileUp, Lock, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { HomeSection } from "../../home/home-section";
import { ToastViewport, useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { BankPickerSheet } from "./bank-picker-sheet";
import { ConnectionCard } from "./connection-card";
import type { AccountOption, CallbackError, ConnectionView } from "./view";

function Tile({ children }: { children: ReactNode }) {
  return (
    <span className="bg-secondary text-primary grid size-8 shrink-0 place-items-center rounded-[10px] [&_svg]:size-4">{children}</span>
  );
}

/** More > Bank: the empty card, each connection (link step or summary), and the bank picker. */
export function BankConnectionScreen({
  connections,
  accounts,
  error,
  justConnected,
  justReconnected,
}: {
  connections: ConnectionView[];
  accounts: AccountOption[];
  error: CallbackError | null;
  justConnected: boolean;
  justReconnected: boolean;
}) {
  const t = useTranslations("settings.bankConnection");
  const [picking, setPicking] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (justReconnected) toast.show({ message: t("toast.reconnected") });
    // Once per arrival from the bank; `toast` and `t` change identity without meaning a new arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justReconnected]);

  const csvRow = (
    <Link href="/import" className="grid min-h-[52px] grid-cols-[32px_1fr_16px] items-center gap-3 px-3.5">
      <Tile>
        <FileUp aria-hidden="true" />
      </Tile>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold">{t("importCsvTitle")}</span>
        <span className="text-muted-foreground text-xs">{t("importCsvHint")}</span>
      </span>
      <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
    </Link>
  );

  return (
    <>
      {error && (
        <p role="alert" className="border-warning/40 bg-warning-soft rounded-[10px] border px-4 py-3 text-sm" data-testid="bank-error">
          {t(`callbackErrors.${error}`)}
        </p>
      )}
      {justConnected && connections.some((c) => c.needsLinking) && (
        <p role="status" className="text-muted-foreground text-sm">
          {t("justConnected")}
        </p>
      )}

      {connections.length === 0 ? (
        <>
          <section aria-labelledby="bank-empty-title" className="bg-card flex flex-col gap-3.5 rounded-lg border p-3.5">
            <h2 id="bank-empty-title" className="text-base font-bold">
              {t("empty.title")}
            </h2>
            <ul className="text-muted-foreground flex flex-col gap-3 text-[13px]">
              {(
                [
                  [Clock, t("empty.factDaily")],
                  [Lock, t("empty.factPassword")],
                  [Eye, t("empty.factReadOnly")],
                ] as const
              ).map(([Icon, text]) => (
                <li key={text} className="grid grid-cols-[32px_1fr] items-center gap-3">
                  <Tile>
                    <Icon aria-hidden="true" />
                  </Tile>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </section>
          <HomeSection headingId="bank-without-sync" title={t("empty.withoutSync")} flush>
            {csvRow}
          </HomeSection>
          <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 bg-gradient-to-b from-transparent to-[#04051a]/95 to-25% px-4 pt-3 pb-1 md:-mx-8 md:px-8 lg:static lg:mx-0 lg:bg-none lg:p-0">
            <Button type="button" className="h-12 w-full rounded-xl font-bold" onClick={() => setPicking(true)}>
              {t("connectChoose")}
            </Button>
          </div>
        </>
      ) : (
        <>
          {connections.map((connection) => (
            <ConnectionCard key={connection.id} connection={connection} accounts={accounts} />
          ))}
          <div className="bg-card divide-border divide-y overflow-hidden rounded-lg border">
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="grid min-h-[52px] w-full grid-cols-[32px_1fr_16px] items-center gap-3 px-3.5 text-left"
            >
              <Tile>
                <Plus aria-hidden="true" />
              </Tile>
              <span className="text-sm font-semibold">{t("connectAnother")}</span>
              <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
            </button>
            {csvRow}
          </div>
        </>
      )}

      <BankPickerSheet open={picking} onOpenChange={setPicking} />
      <ToastViewport />
    </>
  );
}
