import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import { startConnect } from "@/lib/bank-sync/connect";
import { BANK_CONNECTION_PATH, bankSyncFor, callbackUrl, newAuthState } from "@/lib/bank-sync/server";
import { redactError } from "@/lib/logging/redact";

const querySchema = z.object({
  aspsp: z.string().trim().min(1).max(200),
  country: z.string().regex(/^[A-Z]{2}$/),
  // Reconnect: the user's connection this one replaces (checked to be theirs in startConnect).
  reconnect: z.uuid().optional(),
});

/**
 * Starts a connection and sends the browser to the bank's login page. A GET link rather than a form
 * post, because the CSP's `form-action 'self'` would block a form whose response redirects off-site.
 */
export async function GET(request: Request): Promise<Response> {
  const back = (code: string) => Response.redirect(new URL(`${BANK_CONNECTION_PATH}?error=${code}`, request.url), 303);

  try {
    const user = await requireUser();
    const sync = bankSyncFor(user.email);
    if (!sync) return new Response(null, { status: 404 });
    const params = new URL(request.url).searchParams;
    const query = querySchema.safeParse({
      aspsp: params.get("aspsp"),
      country: params.get("country"),
      reconnect: params.get("reconnect") ?? undefined,
    });
    if (!query.success) return back("unknown_bank");

    const result = await startConnect({
      api: sync.client,
      store: sync.store,
      userId: user.id,
      aspsp: { name: query.data.aspsp, country: query.data.country },
      redirectUrl: callbackUrl(request.url),
      state: newAuthState(),
      replacesConnectionId: query.data.reconnect,
      now: new Date(),
    });
    return result.ok ? Response.redirect(result.url, 303) : back(result.code);
  } catch (error) {
    unstable_rethrow(error);
    console.error("bank-sync connect failed", redactError(error));
    return back("unexpected");
  }
}
