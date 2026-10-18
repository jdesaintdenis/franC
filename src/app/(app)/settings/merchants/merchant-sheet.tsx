"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition, type ReactNode } from "react";

import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MERCHANT_NAME_MAX } from "@/lib/merchants/input";
import type { MerchantMatchType } from "@/lib/merchants/match";
import { networkErrorMessage } from "@/lib/offline";

import { addPatternAction, removePatternAction, renameMerchantAction, type MerchantActionResult } from "./actions";
import type { MerchantView } from "./merchant-view";
import { PatternFields } from "./pattern-fields";

const sr = (chunks: ReactNode) => <span className="sr-only">{chunks}</span>;

/** The edit sheet: rename, the patterns with a remove button each (with Undo), and a new pattern. */
export function MerchantSheet({ merchant, onSaved }: { merchant: MerchantView; onSaved: () => void }) {
  const t = useTranslations("settings.merchants");
  const tErrors = useTranslations("settings.merchants.errors");
  const toast = useToast();
  const [name, setName] = useState(merchant.name);
  const [addingPattern, setAddingPattern] = useState(false);
  const [matchType, setMatchType] = useState<MerchantMatchType>("equals");
  const [pattern, setPattern] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Runs an action; `onOk` only on success. Errors are codes translated here. */
  function run(action: () => Promise<MerchantActionResult>, onOk: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.status === "error") {
          setError(tErrors(result.error));
          return;
        }
        onOk();
      } catch {
        setError(networkErrorMessage(tErrors("saveFailed"), tErrors("offline")));
      }
    });
  }

  function removePattern(p: MerchantView["patterns"][number]) {
    run(
      () => removePatternAction(p.id),
      () =>
        toast.show({
          message: t("toast.patternRemoved"),
          undo: {
            onUndo: async () => {
              try {
                const result = await addPatternAction({ merchantId: merchant.id, matchType: p.matchType, pattern: p.pattern });
                if (result.status === "error") toast.show({ message: tErrors(result.error), variant: "error" });
              } catch {
                toast.show({ message: tErrors("saveFailed"), variant: "error" });
              }
            },
          },
        }),
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => renameMerchantAction({ merchantId: merchant.id, name }),
            () => {
              toast.show({ message: t("toast.saved") });
              onSaved();
            },
          );
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`merchant-rename-${merchant.id}`}>{t("form.name")}</Label>
          <Input
            id={`merchant-rename-${merchant.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MERCHANT_NAME_MAX}
            autoComplete="off"
            required
            disabled={pending}
            className="h-11 text-base md:text-sm"
          />
        </div>
        <Button type="submit" pending={pending} className="h-11 self-start">
          {pending ? t("form.saving") : t("form.save")}
        </Button>
      </form>

      <section aria-labelledby={`patterns-${merchant.id}`} className="flex flex-col gap-2">
        <h3 id={`patterns-${merchant.id}`} className="text-sm font-semibold">
          {t("patternsHeading")}
        </h3>
        <ul aria-label={t("patternsLabel", { name: merchant.name })} className="flex flex-col gap-1">
          {merchant.patterns.map((p) => (
            <li key={p.id} className="bg-muted/50 flex items-center gap-2 rounded-md py-1 pr-1 pl-3 text-sm">
              <span className="min-w-0 flex-1 wrap-anywhere">
                <span className="text-muted-foreground">{t(`form.matchTypes.${p.matchType}`)}</span>{" "}
                <span className="font-medium">{p.pattern}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                className="size-11 shrink-0 p-0"
                disabled={pending}
                onClick={() => removePattern(p)}
              >
                <X className="size-4" aria-hidden="true" />
                {t.rich("removePattern", { pattern: p.pattern, sr })}
              </Button>
            </li>
          ))}
        </ul>

        {addingPattern ? (
          <form
            className="flex flex-col gap-3 rounded-md border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => addPatternAction({ merchantId: merchant.id, matchType, pattern }),
                () => {
                  setAddingPattern(false);
                  setPattern("");
                },
              );
            }}
          >
            <PatternFields
              suffix={merchant.id}
              matchType={matchType}
              pattern={pattern}
              disabled={pending}
              onMatchType={setMatchType}
              onPattern={setPattern}
            />
            <div className="flex gap-2">
              <Button type="submit" pending={pending} className="h-11">
                {pending ? t("form.adding") : t("form.addPattern")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={pending}
                onClick={() => {
                  setAddingPattern(false);
                  setError(null);
                }}
              >
                {t("form.cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button type="button" variant="outline" className="h-11" onClick={() => setAddingPattern(true)}>
              {t("addPattern")}
            </Button>
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
