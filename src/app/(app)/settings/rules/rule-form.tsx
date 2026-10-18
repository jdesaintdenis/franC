"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { NATIVE_CHECKBOX_CLASS, NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NoCategoriesHint } from "@/components/no-categories-hint";
import { MAX_PATTERN } from "@/lib/categorize/schemas";

import { createRuleAction, updateRuleAction, type RuleFormState } from "./actions";
import { type CategoryOption, type RuleView } from "./rule-types";

const MATCH_TYPES = ["contains", "equals", "regex"] as const;
const SELECT_CLASS = `${NATIVE_SELECT_CLASS} h-10`;

export function RuleForm({
  mode,
  categories,
  rule,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  categories: CategoryOption[];
  rule?: RuleView;
  /** Called after the rule was added or saved, with how many transactions it categorized. */
  onSaved?: (categorized: number) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("settings.rules");
  const [state, action, pending] = useActionState(
    async (prev: RuleFormState, formData: FormData) => {
      const result = mode === "create" ? await createRuleAction(prev, formData) : await updateRuleAction(prev, formData);
      if (result?.status === "ok") onSaved?.(result.categorized ?? 0);
      return result;
    },
    undefined,
  );
  const suffix = rule?.id ?? "new";
  const hasError = state?.status === "error";
  if (categories.length === 0) return <NoCategoriesHint />;
  const errorId = `rule-error-${suffix}`;

  return (
    <form action={action} className="flex flex-col gap-3">
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`category-${suffix}`}>{t("form.category")}</Label>
        <select
          id={`category-${suffix}`}
          name="categoryId"
          required
          defaultValue={rule?.categoryId ?? categories[0]?.id}
          className={SELECT_CLASS}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`match-${suffix}`}>{t("form.matchType")}</Label>
        <select
          id={`match-${suffix}`}
          name="matchType"
          defaultValue={rule?.matchType ?? "contains"}
          className={SELECT_CLASS}
        >
          {MATCH_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`matchType.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`pattern-${suffix}`}>{t("form.pattern")}</Label>
        <Input
          id={`pattern-${suffix}`}
          name="pattern"
          required
          maxLength={MAX_PATTERN}
          defaultValue={rule?.pattern ?? ""}
          className="h-10"
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? errorId : undefined}
        />
      </div>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" name="apply" defaultChecked className={`${NATIVE_CHECKBOX_CLASS} size-4`} />
        {t("form.apply")}
      </label>
      {state?.status === "error" && (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" pending={pending} className="h-10">
          {mode === "create" ? (pending ? t("form.adding") : t("form.add")) : pending ? t("form.saving") : t("form.save")}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" className="h-10" disabled={pending} onClick={onCancel}>
            {t("form.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
