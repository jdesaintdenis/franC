import { NextResponse, type NextRequest } from "next/server";

// The installed app's service worker answers share POSTs itself (src/app/sw.ts).
// Without it (not installed, or the worker not active yet) the file can't be
// handed over, so both methods just open the import page.
function toImport(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/import", request.url), 303);
}

export const GET = toImport;
export const POST = toImport;
