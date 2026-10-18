import { unstable_rethrow } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { completeConnect } from "@/lib/bank-sync/connect";
import { BANK_CONNECTION_PATH, bankSyncFor } from "@/lib/bank-sync/server";
import { redactError } from "@/lib/logging/redact";

const param = (params: URLSearchParams, key: string) => params.get(key)?.slice(0, 2000) || undefined;

/** The bank sends the user back here with `code` and `state` (or `error`). */
export async function GET(request: Request): Promise<Response> {
  const to = (query: string) => Response.redirect(new URL(`${BANK_CONNECTION_PATH}?${query}`, request.url), 303);

  try {
    const user = await requireUser();
    const sync = bankSyncFor(user.email);
    if (!sync) return new Response(null, { status: 404 });
    const params = new URL(request.url).searchParams;
    const result = await completeConnect({
      api: sync.client,
      store: sync.store,
      userId: user.id,
      params: { code: param(params, "code"), state: param(params, "state"), error: param(params, "error") },
      now: new Date(),
    });
    return result.ok ? to(result.reconnected ? "reconnected=1" : "connected=1") : to(`error=${result.code}`);
  } catch (error) {
    unstable_rethrow(error);
    console.error("bank-sync callback failed", redactError(error));
    return to("error=unexpected");
  }
}
