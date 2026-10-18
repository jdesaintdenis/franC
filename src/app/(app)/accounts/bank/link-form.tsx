"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { LinkChoice } from "@/lib/bank-sync/link";
import { sharedSyncFrom } from "@/lib/bank-sync/window";
import { networkErrorMessage } from "@/lib/offline";
import { cn } from "@/lib/utils";

import { saveLinksAction } from "./actions";
import { LinkChoiceSheet } from "./link-choice-sheet";
import { syncNowAction } from "./sync-action";
import type { AccountOption, ConnectionView, LinkRowView } from "./view";

// Values of the choice sheet: "existing:<id>", "new" or "skip".
const encode = (choice: LinkChoice) => (choice.kind === "existing" ? `existing:${choice.accountId}` : choice.kind);

function decode(value: string, link: LinkRowView): LinkChoice {
  if (value.startsWith("existing:")) return { kind: "existing", accountId: value.slice("existing:".length) };
  return value === "new" ? { kind: "new", name: link.newName } : { kind: "skip" };
}

const sectionTitle = "font-title text-primary px-1 pt-2 text-xs font-semibold tracking-[0.14em] uppercase";

/** "Link your accounts": which franC account each bank account feeds, and one start date. Saved in one go. */
export function LinkForm({
  connection,
  accounts,
  onSaved,
  onCancel,
  onDisconnect,
}: {
  connection: ConnectionView;
  accounts: AccountOption[];
  onSaved: () => void;
  onCancel?: () => void;
  onDisconnect?: () => void;
}) {
  const t = useTranslations("settings.bankConnection");
  const id = useId();
  const [values, setValues] = useState(() => new Map(connection.links.map((l) => [l.id, encode(l.choice)])));
  const [picking, setPicking] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ownLinks = new Set(connection.links.map((l) => l.id));

  const chosen = [...values.values()].filter((v) => v.startsWith("existing:"));

  // The start date is asked while it can still matter: before the first sync into this account.
  const asksDate = (link: LinkRowView, vals = values) => {
    const value = vals.get(link.id) ?? "skip";
    return value !== "skip" && (!link.synced || value !== encode(link.choice));
  };
  const defaultDate = (link: LinkRowView, value: string) => {
    if (value === encode(link.choice)) return link.syncFrom;
    return value.startsWith("existing:")
      ? (accounts.find((a) => `existing:${a.id}` === value)?.defaultSyncFrom ?? connection.syncFromMin)
      : connection.syncFromMin;
  };
  // One date for the whole connection: the earliest default among the links that ask for one.
  const suggested = sharedSyncFrom(
    connection.links.filter((l) => asksDate(l)).map((l) => defaultDate(l, values.get(l.id) ?? "skip")),
    connection.syncFromMin,
  );
  const shownDate = date ?? suggested;
  const showsDate = connection.links.some((l) => asksDate(l));
  const duplicate = new Set(chosen).size !== chosen.length;
  const first = connection.needsLinking;

  const labelOf = (link: LinkRowView) => {
    const value = values.get(link.id) ?? "skip";
    if (value === "new") return t("link.new", { name: link.newName });
    if (value === "skip") return t("link.skip");
    return accounts.find((a) => `existing:${a.id}` === value)?.name ?? t("link.skip");
  };
  const maskOf = (link: LinkRowView) => `${link.displayName}${link.ibanLast4 ? ` ••${link.ibanLast4}` : ""}`;

  const submit = () => {
    if (duplicate) {
      setError(t("link.duplicate"));
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const result = await saveLinksAction({
          connectionId: connection.id,
          choices: connection.links.map((link) => ({
            linkId: link.id,
            choice: decode(values.get(link.id) ?? "skip", link),
            syncFrom: asksDate(link) ? shownDate : undefined,
          })),
        });
        if (result.status === "error") {
          setError(result.error);
          return;
        }
        // First save: start the first sync right away; its outcome shows on the card, errors are ignored here.
        if (first) {
          const ids = connection.links.filter((l) => (values.get(l.id) ?? "skip") !== "skip").map((l) => l.id);
          if (ids.length > 0) void syncNowAction(ids).catch(() => undefined);
        }
        onSaved();
      } catch {
        setError(networkErrorMessage(t("errors.saveFailed"), t("offline")));
      }
    });
  };

  const picked = connection.links.find((l) => l.id === picking) ?? null;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {first && <p className="text-muted-foreground text-sm">{t("link.body")}</p>}
      <h3 className={sectionTitle}>{t("link.accounts")}</h3>
      <div className="bg-card divide-border divide-y overflow-hidden rounded-lg border">
        {connection.links.map((link) => (
          <div key={link.id} className="flex flex-col gap-1.5 px-3.5 py-3">
            <p className="text-sm font-semibold wrap-anywhere">
              {link.displayName}
              {link.ibanLast4 && <span className="text-muted-foreground text-xs font-normal"> ••{link.ibanLast4}</span>}
            </p>
            <p className="text-muted-foreground text-xs">{t("feeds")}</p>
            <button
              type="button"
              aria-label={maskOf(link)}
              disabled={pending}
              onClick={() => setPicking(link.id)}
              className="bg-secondary focus-visible:ring-ring/50 flex min-h-11 w-full items-center justify-between gap-2 rounded-[10px] px-3 text-left font-semibold outline-none focus-visible:ring-[3px] disabled:opacity-60"
            >
              <span className="wrap-anywhere">{labelOf(link)}</span>
              <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      {showsDate && (
        <>
          <label htmlFor={`${id}-from`} className={sectionTitle}>
            {t("link.syncFrom")}
          </label>
          <div className="bg-card flex flex-col gap-1.5 rounded-lg border p-3.5">
            <input
              id={`${id}-from`}
              type="date"
              required
              className="bg-secondary h-11 w-full rounded-[10px] px-3 font-semibold"
              min={connection.syncFromMin}
              max={connection.syncFromMax}
              value={shownDate}
              disabled={pending}
              aria-describedby={`${id}-from-hint`}
              onChange={(event) => setDate(event.target.value)}
            />
            <p id={`${id}-from-hint`} className="text-muted-foreground text-xs">
              {t("link.syncFromHint")}
            </p>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-col gap-0.5 bg-gradient-to-b from-transparent to-[#04051a]/95 to-25% px-4 pt-3 pb-1 md:-mx-8 md:px-8 lg:static lg:mx-0 lg:bg-none lg:p-0">
        <Button type="submit" className="h-12 w-full rounded-xl font-bold" disabled={pending}>
          {pending ? t("link.saving") : first ? t("link.saveAndSync") : t("link.save")}
        </Button>
        {first && onDisconnect ? (
          <button type="button" disabled={pending} onClick={onDisconnect} className={cn("text-warning min-h-10 text-[13px] font-semibold")}>
            {t("disconnect.button")}
          </button>
        ) : (
          onCancel && (
            <button type="button" disabled={pending} onClick={onCancel} className="text-muted-foreground min-h-10 text-[13px] font-semibold">
              {t("cancel")}
            </button>
          )
        )}
      </div>

      <LinkChoiceSheet
        open={picked !== null}
        onOpenChange={(open) => !open && setPicking(null)}
        bankAccount={picked ? maskOf(picked) : ""}
        value={picked ? (values.get(picked.id) ?? "skip") : ""}
        options={
          picked
            ? [
                ...accounts.map((account) => ({
                  value: `existing:${account.id}`,
                  label: account.name,
                  // An account another connection already feeds can't be picked here.
                  disabled: account.linkId !== null && !ownLinks.has(account.linkId),
                })),
                { value: "new", label: t("link.new", { name: picked.newName }) },
                { value: "skip", label: t("link.skip") },
              ]
            : []
        }
        onChoose={(value) => {
          if (!picked) return;
          setValues(new Map(values).set(picked.id, value));
          setError(null);
        }}
      />
    </form>
  );
}
