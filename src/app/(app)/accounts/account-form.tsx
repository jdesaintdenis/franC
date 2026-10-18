"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ACCOUNT_NAME_MAX_LENGTH } from "@/lib/accounts/name";

import { createAccountAction, renameAccountAction, type AccountFormState } from "./actions";

export function AccountForm({
  mode,
  account,
  onSaved,
}: {
  mode: "create" | "edit";
  account?: { id: string; name: string };
  /** Called after a successful save. */
  onSaved?: () => void;
}) {
  const t = useTranslations("settings.accounts.form");
  const [state, action, pending] = useActionState(
    async (prev: AccountFormState, formData: FormData) => {
      const result =
        mode === "create" ? await createAccountAction(prev, formData) : await renameAccountAction(prev, formData);
      if (result?.status === "ok") onSaved?.();
      return result;
    },
    undefined,
  );
  const suffix = account?.id ?? "new";
  const hasError = state?.status === "error";
  const errorId = `account-error-${suffix}`;

  return (
    <form action={action} className="flex flex-col gap-3">
      {account && <input type="hidden" name="id" value={account.id} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`account-name-${suffix}`}>{t("name")}</Label>
        <Input
          id={`account-name-${suffix}`}
          name="name"
          required
          maxLength={ACCOUNT_NAME_MAX_LENGTH}
          defaultValue={account?.name ?? ""}
          className="h-11"
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? errorId : undefined}
        />
      </div>
      {state?.status === "error" && (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" pending={pending} className="h-11">
          {mode === "create" ? (pending ? t("adding") : t("add")) : pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
