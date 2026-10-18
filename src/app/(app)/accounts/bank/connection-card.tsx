"use client";

import { Pencil, Unplug } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { useState } from "react";

import { RowMenu } from "@/components/manage/row-menu";
import { useToast } from "@/components/toast";
import { buttonVariants } from "@/components/ui/button";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { DisconnectDialog } from "./disconnect-dialog";
import { SyncNow } from "./sync-now";
import { LinkForm } from "./link-form";
import type { AccountOption, ConnectionView } from "./view";

/** One connection: the link step until it's saved, then which franC account each bank account feeds. */
export function ConnectionCard({ connection, accounts }: { connection: ConnectionView; accounts: AccountOption[] }) {
  const t = useTranslations("settings.bankConnection");
  const locale = useLocale() as "en" | "fr";
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const linking = connection.needsLinking || editing;
  const headingId = `bank-${connection.id}`;
  const syncable = connection.links.filter((l) => l.statusLabel !== null).map((l) => l.id);
  const warn = connection.health.kind === "reconnect" || connection.health.kind === "failing";

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3" data-testid="bank-connection">
      <div className="flex items-start justify-between gap-3 px-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={headingId} className="text-base font-bold wrap-anywhere">
            {connection.bankName}
          </h2>
          {linking ? (
            <p className="text-positive text-xs">{t("connectedUntil", { date: connection.validUntilLabel })}</p>
          ) : (
            <p className={cn("text-xs", warn ? "text-warning font-medium" : "text-muted-foreground")} data-testid="connection-status">
              {connection.statusText}
            </p>
          )}
        </div>
        {!linking && (
          <RowMenu
            label={t("connectionOptions", { bank: connection.bankName })}
            items={[
              { label: t("change"), icon: <Pencil aria-hidden="true" />, onSelect: () => setEditing(true) },
              { label: t("disconnect.menu"), icon: <Unplug aria-hidden="true" />, onSelect: () => setDisconnecting(true), destructive: true },
            ]}
          />
        )}
      </div>

      {linking ? (
        <LinkForm
          connection={connection}
          accounts={accounts}
          onCancel={connection.needsLinking ? undefined : () => setEditing(false)}
          onDisconnect={connection.needsLinking ? () => setDisconnecting(true) : undefined}
          onSaved={() => {
            setEditing(false);
            toast.show({ message: t(connection.needsLinking ? "toast.connected" : "toast.saved") });
          }}
        />
      ) : (
        <>
          <ul aria-label={t("linksLabel")} className="bg-card divide-border divide-y overflow-hidden rounded-lg border">
            {connection.links.map((link) => (
              <li key={link.id} className="grid min-h-14 grid-cols-[1fr_auto] items-center gap-3 px-3.5 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className={cn("text-sm font-semibold wrap-anywhere", !link.accountName && "text-muted-foreground")}>
                    {link.accountName ?? t("notImported")}
                  </span>
                  <span className="text-muted-foreground text-xs wrap-anywhere">
                    {link.displayName}
                    {link.ibanLast4 && ` ••${link.ibanLast4}`}
                  </span>
                  {link.statusLabel && (
                    <span className="text-muted-foreground text-xs" data-testid="sync-status">
                      {link.statusLabel}
                    </span>
                  )}
                </div>
                {link.balanceCents !== null && (
                  <span className="text-[17px] font-bold tabular-nums">{formatCents(link.balanceCents, locale)}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground px-1 text-xs">{t("connectedUntilLong", { date: connection.validUntilLabel })}</p>
          {connection.reconnectHref && (
            <a href={connection.reconnectHref} className={cn(buttonVariants(), "h-12 w-full rounded-xl font-bold")}>
              {t("reconnect")}
            </a>
          )}
          {syncable.length > 0 && (
            <SyncNow
              linkIds={syncable}
              variant={connection.reconnectHref ? "outline" : "default"}
              className="h-12 w-full rounded-xl font-bold"
            />
          )}
        </>
      )}

      <DisconnectDialog
        connection={disconnecting ? connection : null}
        onClose={() => setDisconnecting(false)}
        onDone={() => toast.show({ message: t("toast.disconnected") })}
      />
    </section>
  );
}
