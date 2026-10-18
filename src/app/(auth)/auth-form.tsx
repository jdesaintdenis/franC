"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { AuthFormState } from "./actions";

export function AuthForm({
  mode,
  action,
  next,
  submitLabel,
  pendingLabel,
}: {
  mode: "login" | "signup";
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  next?: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const t = useTranslations("auth.form");
  const [state, formAction, pending] = useActionState(action, undefined);

  const hasError = Boolean(state?.error);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? "auth-error" : undefined}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={8}
          required
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? "auth-error" : undefined}
        />
      </div>
      {state?.error && (
        <p id="auth-error" role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
      <Button type="submit" pending={pending} className="w-full">
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
