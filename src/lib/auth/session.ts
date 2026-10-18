import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "./server";

/**
 * The authoritative auth check (proxy.ts's cookie check is optimistic
 * only). Call this at the top of every protected server component/action.
 * `cache` dedupes repeated calls within one request/render pass.
 */
export const requireUser = cache(async (): Promise<{ id: string; email: string; name: string }> => {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
});
