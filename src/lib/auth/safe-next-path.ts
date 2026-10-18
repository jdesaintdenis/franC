/**
 * Only accept `next` redirect targets that are a relative, same-app path
 * (starting with a single `/`, never `//` — that's protocol-relative and
 * would leave the app, and browsers treat `/\` the same way). Anything
 * else falls back to `/`.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) {
    return "/";
  }
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/";
  }
  return next;
}
