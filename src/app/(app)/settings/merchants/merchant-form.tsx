"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MERCHANT_NAME_MAX } from "@/lib/merchants/input";
import type { MerchantMatchType } from "@/lib/merchants/match";
import { networkErrorMessage } from "@/lib/offline";

import { createMerchantAction } from "./actions";
import { PatternFields } from "./pattern-fields";

export function MerchantForm({ onDone }: { onDone: (rowsRenamed: number) => void }) {
  const t = useTranslations("settings.merchants");
  const tErrors = useTranslations("settings.merchants.errors");
  const [name, setName] = useState("");
  const [matchType, setMatchType] = useState<MerchantMatchType>("equals");
  const [pattern, setPattern] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createMerchantAction({ name, matchType, pattern });
        if (result.status === "error") {
          setError(tErrors(result.error));
          return;
        }
        onDone(result.rowsRenamed);
      } catch {
        setError(networkErrorMessage(tErrors("saveFailed"), tErrors("offline")));
      }
    });
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="merchant-name-new">{t("form.name")}</Label>
        <Input
          id="merchant-name-new"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MERCHANT_NAME_MAX}
          autoComplete="off"
          required
          disabled={pending}
          className="h-11 text-base md:text-sm"
        />
      </div>
      <PatternFields
        suffix="new"
        matchType={matchType}
        pattern={pattern}
        disabled={pending}
        onMatchType={setMatchType}
        onPattern={setPattern}
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" pending={pending} className="h-11">
        {pending ? t("form.adding") : t("form.add")}
      </Button>
    </form>
  );
}
