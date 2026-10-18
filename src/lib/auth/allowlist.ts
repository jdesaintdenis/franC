/**
 * Sign-up is restricted to a fixed set of emails (see CLAUDE.md). The
 * allowlist comes from the `ALLOWED_EMAILS` env var: a comma-separated
 * list, compared case-insensitively with surrounding whitespace trimmed.
 * An empty or unset list denies everybody — there is no "allow all" mode.
 */
export function isEmailAllowed(email: string, rawAllowlist: string | undefined): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !rawAllowlist) {
    return false;
  }

  const allowed = rawAllowlist
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  return allowed.includes(normalizedEmail);
}
