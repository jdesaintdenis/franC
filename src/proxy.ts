import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_PATHS = new Set(["/login", "/signup"]);

/**
 * Optimistic, cookie-only auth gate. This only checks whether a session
 * cookie is present — it never verifies the session against the database.
 * `requireUser()` (src/lib/auth/session.ts) is the authoritative check and
 * runs in the protected layout; this just avoids rendering protected pages
 * (and shipping their server work) for obviously-unauthenticated requests.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSessionCookie = Boolean(getSessionCookie(request));

  // Signed-in visitors on /login or /signup are bounced to / by the (auth)
  // layout after a real session check. Doing it here from the cookie alone
  // would loop forever on a stale cookie (proxy → / → requireUser → /login).
  if (!PUBLIC_PATHS.has(pathname) && !hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Run on every path except:
     * - /api/auth/* (Better Auth's own routes)
     * - /api/cron/* (scheduled jobs; each route checks its own CRON_SECRET bearer token)
     * - /_next/* (Next.js internals and static assets)
     * - the PWA shell: /offline, /manifest.webmanifest, /sw.js, /swe-worker-*
     * - icon routes: /icon*, /apple-icon*, /icons/*, /favicon.ico
     * - any other file with an extension (e.g. images fetched directly)
     */
    "/((?!api/auth|api/cron|_next|offline$|manifest\\.webmanifest$|sw\\.js$|swe-worker-.*|icon.*|apple-icon.*|icons/|favicon\\.ico$|.*\\..*).*)",
  ],
};
