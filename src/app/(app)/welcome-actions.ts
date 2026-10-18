"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import { markWelcomeCompleted } from "@/db/queries/welcome";
import { requireUser } from "@/lib/auth/session";

/** "Hide" on the welcome checklist: it stays hidden for good. */
export async function hideWelcomeAction(): Promise<void> {
  const user = await requireUser();
  await markWelcomeCompleted(db, user.id);
  revalidatePath("/");
}
