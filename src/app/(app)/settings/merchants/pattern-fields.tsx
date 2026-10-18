"use client";

import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import { MERCHANT_PATTERN_MAX } from "@/lib/merchants/input";
import type { MerchantMatchType } from "@/lib/merchants/match";

export const MATCH_TYPES = ["equals", "starts_with", "contains"] as const satisfies readonly MerchantMatchType[];

/** Match type + pattern, shared by "add merchant" and "add pattern". `suffix` keeps ids unique per form. */
export function PatternFields({
  suffix,
  matchType,
  pattern,
  disabled,
  onMatchType,
  onPattern,
}: {
  suffix: string;
  matchType: MerchantMatchType;
  pattern: string;
  disabled: boolean;
  onMatchType: (value: MerchantMatchType) => void;
  onPattern: (value: string) => void;
}) {
  const t = useTranslations("settings.merchants.form");
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`merchant-match-${suffix}`}>{t("matchType")}</Label>
        <select
          id={`merchant-match-${suffix}`}
          value={matchType}
          onChange={(e) => onMatchType(e.target.value as MerchantMatchType)}
          disabled={disabled}
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
        <Label htmlFor={`merchant-pattern-${suffix}`}>{t("pattern")}</Label>
        <Input
          id={`merchant-pattern-${suffix}`}
          value={pattern}
          onChange={(e) => onPattern(e.target.value)}
          maxLength={MERCHANT_PATTERN_MAX}
          autoComplete="off"
          required
          disabled={disabled}
          className="h-11 w-full text-base md:text-sm"
        />
      </div>
    </>
  );
}
