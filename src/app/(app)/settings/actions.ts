"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { withActionErrors } from "@/lib/actions/safe-action";
import { auth } from "@/lib/auth/server";

export type SignOutState = { status: "error"; error: string } | undefined;

export async function signOutAction(): Promise<SignOutState> {
  const t = await getTranslations("settings.signOut");
  return withActionErrors(t("error"), async (): Promise<SignOutState> => {
    await auth.api.signOut({ headers: await headers() });
    // redirect() throws; withActionErrors rethrows it as control flow.
    redirect("/login");
  });
}
