"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { TransactionListItem } from "@/db/queries/transactions";
import type { TransferForTransaction } from "@/db/queries/transfers";
import { normalizeLabel } from "@/lib/import/normalize-label";
import { formatCents } from "@/lib/money";
import { savingsRulePattern } from "@/lib/savings/rules";

import { moveToSavingsAction, type TransferErrorCode } from "./actions";

/** A Savings account with the goals kept in it (Slice 55). */
export interface SavingsAccountOption {
  id: string;
  name: string;
  goals: { id: string; name: string; icon: string | null; savedCents: number }[];
}

export interface MovedToSavings {
  transfer: TransferForTransaction | null;
  ruleId: string | null;
  pastMoved: number;
  accountName: string;
  /** Name of the goal the money went to, if one was tapped. */
  goalName: string | null;
}

/**
 * The "Move to savings" step: pick a Savings account (money not assigned to a goal) or one of its goals, and franC
 * creates the counterpart row there and links the pair. The checkbox also stores a label rule and moves the earlier
 * payments that match (Slice 52); for money in, the rule carries the tapped goal (Slice 55).
 */
export function SavingsStep({
  item,
  accounts,
  onMoved,
}: {
  item: TransactionListItem;
  accounts: SavingsAccountOption[];
  onMoved: (moved: MovedToSavings) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("transactions.savings");
  const tTransfer = useTranslations("transactions.transfer");
  const [withRule, setWithRule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const outflow = item.amountCents < 0;
  // Same choice the server makes: the merchant's name, else the label's merchant key.
  const pattern = savingsRulePattern(item.merchant?.name ?? null, normalizeLabel(item.bankLabel ?? item.shortLabel));

  function move(account: SavingsAccountOption, goal: SavingsAccountOption["goals"][number] | null) {
    setError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof moveToSavingsAction>>;
      try {
        result = await moveToSavingsAction({ transactionId: item.id, accountId: account.id, goalId: goal?.id ?? null, withRule: withRule && pattern !== null });
      } catch {
        setError(tTransfer("errors.failed"));
        return;
      }
      if (result.status === "error") {
        setError(tTransfer(`errors.${result.error satisfies TransferErrorCode}`));
        return;
      }
      onMoved({ transfer: result.transfer, ruleId: result.ruleId, pastMoved: result.pastMoved, accountName: account.name, goalName: goal?.name ?? null });
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="savings-step">
      <p className="text-muted-foreground text-sm">
        {t(outflow ? "explainOut" : "explainIn", { amount: formatCents(Math.abs(item.amountCents), locale) })}
      </p>
      {pattern !== null && (
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-5" checked={withRule} disabled={pending} onChange={(e) => setWithRule(e.target.checked)} />
          <span className="flex min-w-0 flex-col">
            <span>{t("withRule")}</span>
            <span className="text-muted-foreground break-words">{t("rulePattern", { pattern })}</span>
            {outflow && accounts.some((a) => a.goals.length > 0) && <span className="text-muted-foreground">{t("ruleGoalHint")}</span>}
          </span>
        </label>
      )}
      <ul className="flex flex-col gap-2">
        {accounts.map((account) => (
          <li key={account.id} className="flex flex-col gap-2">
            <Button type="button" variant="outline" className="h-11 w-full justify-start" disabled={pending} onClick={() => move(account, null)}>
              {account.goals.length > 0 ? t("notAssignedButton", { account: account.name }) : account.name}
            </Button>
            {account.goals.map((goal) => {
              // Money out has to come from a goal that holds enough.
              const short = !outflow && goal.savedCents < Math.abs(item.amountCents);
              return (
                <Button
                  key={goal.id}
                  type="button"
                  variant="outline"
                  data-testid="savings-goal-button"
                  className="h-11 w-full justify-between pl-8"
                  disabled={pending || short}
                  onClick={() => move(account, goal)}
                >
                  <span className="min-w-0 truncate">
                    {goal.icon ? `${goal.icon} ` : ""}
                    {goal.name}
                  </span>
                  {!outflow && <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{t("goalHolds", { amount: formatCents(goal.savedCents, locale) })}</span>}
                </Button>
              );
            })}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
