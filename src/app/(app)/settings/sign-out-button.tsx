"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { signOutAction, type SignOutState } from "./actions";

// Separate component: useFormStatus only reads the status of a parent <form>.
function SubmitButton() {
  const t = useTranslations("settings.signOut");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" className="text-primary h-10 font-semibold" pending={pending}>
      {pending ? t("pending") : t("button")}
    </Button>
  );
}

export function SignOutButton() {
  const tToast = useTranslations("common.toast");
  const toast = useToast();
  const [state, action] = useActionState((): Promise<SignOutState> => signOutAction(), undefined);

  // A failed sign-out is a toast; Try again submits the form once more.
  useEffect(() => {
    if (state?.status !== "error") return;
    toast.show({
      message: state.error,
      variant: "error",
      action: { label: tToast("retry"), onAction: () => (document.getElementById("sign-out-form") as HTMLFormElement | null)?.requestSubmit() },
    });
    // `state` is a fresh object per attempt, so a second failure shows the toast again.
  }, [state, toast, tToast]);

  return (
    <form id="sign-out-form" action={action} className="flex shrink-0 items-center">
      <SubmitButton />
    </form>
  );
}
