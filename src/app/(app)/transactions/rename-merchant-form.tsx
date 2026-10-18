"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import { MERCHANT_NAME_MAX, MERCHANT_PATTERN_MAX } from "@/lib/merchants/input";
import type { MerchantMatchType } from "@/lib/merchants/match";
import { networkErrorMessage } from "@/lib/offline";

import {
  createMerchantAction,
  previewPatternMatchesAction,
} from "../settings/merchants/actions";

const MATCH_TYPES = ["equals", "starts_with", "contains"] as const satisfies readonly MerchantMatchType[];
const PREVIEW_DELAY_MS = 300;

interface Props {
  /** The row's current merchant name, if it has one. */
  currentName: string | null;
  /** The bank's short label: the safest starting pattern. */
  shortLabel: string;
  /** Names the user already has, suggested while typing. */
  merchantNames: string[];
  onCancel: () => void;
  /** Saved: the caller shows the confirmation and refreshes the list. */
  onSaved: (saved: RenameSaved) => void;
}

export interface RenameSaved {
  name: string;
  rowsRenamed: number;
  /** What Undo removes: the pattern, and the merchant when this created it. */
  merchantId?: string;
  patternId?: string;
  created: boolean;
}

export function RenameMerchantForm({ currentName, shortLabel, merchantNames, onCancel, onSaved }: Props) {
  const t = useTranslations("transactions.merchant");
  const tErrors = useTranslations("transactions.merchant.errors");
  const tActions = useTranslations("common.actions");
  const listId = useId();
  const [name, setName] = useState(currentName ?? "");
  const [matchType, setMatchType] = useState<MerchantMatchType>("equals");
  const [pattern, setPattern] = useState(shortLabel);
  // undefined = not counted yet, null = pattern unusable.
  const [count, setCount] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const latest = useRef(0);

  // Debounced live count; a stale answer must not overwrite a newer one.
  useEffect(() => {
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        const result = await previewPatternMatchesAction({ matchType, pattern });
        if (ticket === latest.current && result.status === "ok") setCount(result.count);
      } catch {
        // The count is a hint: offline or failing, the form still saves.
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [matchType, pattern]);

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createMerchantAction({ name, matchType, pattern });
        if (result.status === "error") {
          setError(tErrors(result.error));
          return;
        }
        onSaved({ name, rowsRenamed: result.rowsRenamed, merchantId: result.merchantId, patternId: result.patternId, created: result.created === true });
      } catch {
        setError(networkErrorMessage(tErrors("saveFailed"), tErrors("offline")));
      }
    });
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border p-3"
      aria-label={t("formLabel")}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="merchant-name">{t("name")}</Label>
        <Input
          id="merchant-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          list={listId}
          maxLength={MERCHANT_NAME_MAX}
          autoComplete="off"
          required
          disabled={isPending}
          className="h-11 w-full text-base md:text-sm"
        />
        <datalist id={listId}>
          {merchantNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="merchant-match-type">{t("matchType")}</Label>
        <select
          id="merchant-match-type"
          value={matchType}
          onChange={(e) => setMatchType(e.target.value as MerchantMatchType)}
          disabled={isPending}
          className={`${NATIVE_SELECT_CLASS} h-11`}
        >
          {MATCH_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`matchTypes.${type}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="merchant-pattern">{t("pattern")}</Label>
        <Input
          id="merchant-pattern"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          maxLength={MERCHANT_PATTERN_MAX}
          autoComplete="off"
          required
          disabled={isPending}
          className="h-11 w-full text-base md:text-sm"
        />
      </div>
      <p className="text-muted-foreground min-h-5 text-sm" aria-live="polite">
        {typeof count === "number" ? t("preview", { count }) : ""}
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-11 flex-1" disabled={isPending} onClick={onCancel}>
          {tActions("cancel")}
        </Button>
        <Button type="submit" className="h-11 flex-1" disabled={isPending}>
          {isPending ? t("saving") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
