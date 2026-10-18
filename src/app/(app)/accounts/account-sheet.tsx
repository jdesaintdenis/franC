"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";

import { useToast } from "@/components/toast";
import { formatShortDay } from "@/lib/format-date";
import { formatCents } from "@/lib/money";

import {
  deleteSavingsRuleAction,
  restoreSavingsRuleAction,
  setAccountSavingsAction,
  setImportReminderAction,
  setInSafeToSpendAction,
} from "./actions";
import { AccountForm } from "./account-form";
import type { AccountView } from "./account-view";
import { gapSentence } from "../balance-gap";
import { BalanceGapPanel } from "../balance-gap-panel";
import { BalanceForm } from "./balance-form";
import { BankBalanceForm } from "./bank-balance-form";

/** The account sheet: rename, starting balance and alert level, and the two switches. */
export function AccountSheet({
  account,
  isLast,
  showReminder,
  today,
  onSaved,
}: {
  account: AccountView;
  isLast: boolean;
  /** Only with several accounts: a single account is always the one to import into. */
  showReminder: boolean;
  today: string;
  onSaved: () => void;
}) {
  const t = useTranslations("settings.accounts");
  const gapT = useTranslations("dashboard.balanceGap");
  const locale = useLocale();
  const toast = useToast();
  const saved = () => {
    toast.show({ message: t("toast.saved") });
    onSaved();
  };

  const [checked, setChecked] = useState(account.inSafeToSpend);
  const [safeError, setSafeError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const toggleSafeToSpend = (next: boolean) => {
    setChecked(next);
    setSafeError(null);
    startSaving(async () => {
      const result = await setInSafeToSpendAction(account.id, next);
      if (result.status === "error") {
        setChecked(!next);
        setSafeError(result.error);
      }
    });
  };

  // Account type: switching to Savings also takes the account out of safe to spend (the server does it too).
  const [isSavings, setIsSavings] = useState(account.savings);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [savingType, startSavingType] = useTransition();
  const changeType = (next: boolean) => {
    if (next === isSavings) return;
    setIsSavings(next);
    setTypeError(null);
    startSavingType(async () => {
      const result = await setAccountSavingsAction(account.id, next);
      if (result.status === "error") {
        setIsSavings(!next);
        setTypeError(result.error);
        return;
      }
      if (next) setChecked(false);
      toast.show({ message: next ? t("type.nowSavings") : t("type.nowCurrent") });
    });
  };

  const [rules, setRules] = useState(account.savingsRules);
  const removeRule = (rule: (typeof account.savingsRules)[number]) => {
    setRules((current) => current.filter((r) => r.id !== rule.id));
    startSavingType(async () => {
      const result = await deleteSavingsRuleAction(rule.id);
      if (result.status === "error") {
        setRules(account.savingsRules);
        toast.show({ message: result.error, variant: "error" });
        return;
      }
      toast.show({
        message: t("savingsRules.removed"),
        undo: {
          onUndo: async () => {
            const restored = await restoreSavingsRuleAction(result.accountId, result.pattern, result.goalId);
            if (restored.status === "error") {
              toast.show({ message: restored.error, variant: "error" });
              return;
            }
            setRules((current) => [...current, rule]);
          },
        },
      });
    });
  };

  const [reminderChecked, setReminderChecked] = useState(account.importReminder);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [savingReminder, startSavingReminder] = useTransition();
  const toggleReminder = (next: boolean) => {
    setReminderChecked(next);
    setReminderError(null);
    startSavingReminder(async () => {
      const result = await setImportReminderAction(account.id, next);
      if (result.status === "error") {
        setReminderChecked(!next);
        setReminderError(result.error);
      }
    });
  };

  const { startingBalance, bankBalance, gap } = account;
  return (
    <div className="flex flex-col gap-6">
      <AccountForm mode="edit" account={account} onSaved={saved} />

      <section aria-labelledby={`balance-heading-${account.id}`} className="flex flex-col gap-3 border-t pt-4">
        <div className="flex flex-col gap-0.5">
          <h3 id={`balance-heading-${account.id}`} className="text-sm font-semibold">
            {bankBalance ? t("sheet.balanceHeadingBank") : t("sheet.balanceHeading")}
          </h3>
          {!bankBalance && (
            <p className="text-muted-foreground text-sm">
              {startingBalance
                ? t("balance.summary", {
                    amount: formatCents(startingBalance.cents, locale),
                    date: formatShortDay(startingBalance.date, today, locale),
                  })
                : t("balance.none")}
            </p>
          )}
        </div>
        {bankBalance ? (
          <BankBalanceForm account={account} bank={bankBalance} onSaved={saved} />
        ) : (
          <>
            <BalanceForm account={account} current={startingBalance} today={today} onSaved={saved} />
            {account.connected && (
              <p className="text-muted-foreground text-sm" data-testid="bank-balance-pending">
                {t("balance.pendingBank")}
              </p>
            )}
          </>
        )}
      </section>

      {gap && (
        <section aria-labelledby={`gap-heading-${account.id}`} className="flex flex-col gap-3 border-t pt-4" data-testid="account-balance-gap">
          <div className="flex flex-col gap-0.5">
            <h3 id={`gap-heading-${account.id}`} className="text-sm font-semibold">
              {gapT("title")}
            </h3>
            <p className="text-muted-foreground text-sm">
              {gapSentence(gapT, locale, { accountId: account.id, name: null, ...gap }, today)}
            </p>
          </div>
          <BalanceGapPanel gap={{ accountId: account.id, name: null, ...gap }} onAccepted={onSaved} />
        </section>
      )}

      <fieldset className="flex flex-col gap-1 border-t pt-3" disabled={savingType} data-testid="account-type">
        <legend className="mb-1 text-sm font-semibold">{t("type.legend")}</legend>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="radio" name={`type-${account.id}`} className="size-5" checked={!isSavings} onChange={() => changeType(false)} />
          {t("type.current")}
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="radio" name={`type-${account.id}`} className="size-5" checked={isSavings} onChange={() => changeType(true)} />
          {t("type.savings")}
        </label>
        {isSavings && <p className="text-muted-foreground text-sm">{t("type.savingsHint")}</p>}
        {typeError && (
          <p role="alert" className="text-destructive text-sm">
            {typeError}
          </p>
        )}
      </fieldset>

      {isSavings && (
        <section aria-labelledby={`rules-heading-${account.id}`} className="flex flex-col gap-2 border-t pt-4" data-testid="savings-rules">
          <h3 id={`rules-heading-${account.id}`} className="text-sm font-semibold">
            {t("savingsRules.heading")}
          </h3>
          {rules.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("savingsRules.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {rules.map((rule) => (
                <li key={rule.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 break-words">
                    {rule.goalName === null
                      ? t("savingsRules.rule", { pattern: rule.pattern })
                      : t("savingsRules.ruleWithGoal", { pattern: rule.pattern, goal: rule.goalName })}
                  </span>
                  <button
                    type="button"
                    className="min-h-11 shrink-0 px-2 underline underline-offset-4 disabled:opacity-50"
                    disabled={savingType}
                    aria-label={t("savingsRules.removeLabel", { pattern: rule.pattern })}
                    onClick={() => removeRule(rule)}
                  >
                    {t("savingsRules.remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-label={t("sheet.optionsHeading")} className="flex flex-col gap-1 border-t pt-3">
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={checked}
            disabled={saving}
            onChange={(e) => toggleSafeToSpend(e.target.checked)}
          />
          {t("safeToSpend.label")}
        </label>
        {safeError && (
          <p role="alert" className="text-destructive text-sm">
            {safeError}
          </p>
        )}
        {showReminder && !isSavings && (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={reminderChecked}
              disabled={savingReminder}
              onChange={(e) => toggleReminder(e.target.checked)}
            />
            {t("importReminder.label")}
          </label>
        )}
        {reminderError && (
          <p role="alert" className="text-destructive text-sm">
            {reminderError}
          </p>
        )}
      </section>

      {account.goals.length > 0 && (
        <section aria-labelledby={`goals-heading-${account.id}`} className="flex flex-col gap-1 border-t pt-4" data-testid="account-goals">
          <h3 id={`goals-heading-${account.id}`} className="text-sm font-semibold">
            {t("sheet.goalsHeading")}
          </h3>
          <ul className="flex flex-col gap-1 text-sm">
            {account.goals.map((goal) => (
              <li key={goal.id} className="break-words tabular-nums">
                {t("sheet.goalLine", { name: goal.name, amount: formatCents(goal.savedCents, locale) })}
              </li>
            ))}
            {account.notAssignedCents !== null && (
              <li className="text-muted-foreground tabular-nums">
                {account.notAssignedCents < 0
                  ? t("sheet.overAssigned", { amount: formatCents(-account.notAssignedCents, locale) })
                  : t("sheet.notAssigned", { amount: formatCents(account.notAssignedCents, locale) })}
              </li>
            )}
          </ul>
          <Link href="/settings/goals" className="min-h-11 content-center text-sm underline underline-offset-4">
            {t("sheet.manageGoals")}
          </Link>
        </section>
      )}
      {isLast && <p className="text-muted-foreground text-sm">{t("delete.lastHint")}</p>}
    </div>
  );
}
