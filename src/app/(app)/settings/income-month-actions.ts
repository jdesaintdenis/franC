"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { setIncomeMonth as saveIncomeMonth } from "@/db/queries/users";
import { withActionErrors } from "@/lib/actions/safe-action";
import { requireUser } from "@/lib/auth/session";
import type { IncomeMonth } from "@/lib/safe-to-spend/compute";

const inputSchema = z.enum(["this", "next"]);

export type SetIncomeMonthResult = { status: "ok"; incomeMonth: IncomeMonth } | { status: "error"; error: string };

/** Saves which month Reste à vivre counts incoming money for (Slice 75). The UI shows its own translated error. */
export async function setIncomeMonth(value: unknown): Promise<SetIncomeMonthResult> {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) return { status: "error", error: "Invalid choice." };

  const user = await requireUser();
  const result = await withActionErrors("Could not save the choice.", async (): Promise<SetIncomeMonthResult> => {
    await saveIncomeMonth(user.id, parsed.data);
    return { status: "ok", incomeMonth: parsed.data };
  });
  if (result.status === "ok") {
    revalidatePath("/");
    revalidatePath("/settings");
  }
  return result;
}
