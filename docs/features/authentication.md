# Authentication

franC holds financial data, so every page except sign in and sign up requires an account. It is a single-user app: only the emails you allow can create an account.

## Using it

- **Sign up** at `/signup` with an email listed in the `ALLOWED_EMAILS` environment variable, and a password.
- **Sign in** at `/login`. After signing in you land on the page you were trying to open (the `next` path is checked so it can only point inside the app).
- **Sign out** from More.

## How it works

- **Library**: Better Auth, email + password only. Sessions are cookie-based.
- **Allowlist**: `ALLOWED_EMAILS` is a comma-separated, case-insensitive list. Empty means nobody can sign up. Sign-up for any other email is refused.
- **Protection is layered**:
  - `src/proxy.ts` does a fast, optimistic check that a session cookie exists and redirects to `/login` otherwise. It skips auth endpoints, PWA assets and public files.
  - The authoritative check is `requireUser()` (`src/lib/auth/session.ts`). The `(app)` layout calls it, and **every server action and route handler calls it too**.
- **Table names**: Better Auth's tables are `users`, `sessions`, `auth_accounts` (login methods) and `verifications`. The name `accounts` is reserved for bank accounts.
- **User preferences** (`users.locale`, `users.theme`) are Better Auth `additionalFields`, so they arrive with the session at no extra query.
- **New-user defaults**: on sign-up, `provisionUserDefaults` creates one bank account, named in the sign-up language ("Main account", or "Compte principal" in French; cookie then browser language). No categories are created (they come from the first import — see [Categorization](categorization.md)).

## Code

- `src/lib/auth/server.ts` — Better Auth configuration
- `src/lib/auth/allowlist.ts` — `ALLOWED_EMAILS` parsing and check
- `src/lib/auth/session.ts` — `requireUser()`
- `src/lib/auth/safe-next-path.ts` — post-login redirect validation
- `src/proxy.ts` — optimistic cookie check
- `src/app/(auth)/` — login and signup pages and actions
- `src/app/api/auth/` — Better Auth endpoints
- `src/db/queries/provision.ts` — default account on sign-up

## Tests

`src/lib/auth/*.test.ts`, `src/db/queries/provision.test.ts`, `src/db/queries/users.test.ts`; E2E login flow in `e2e/`. E2E logs in as `E2E_USER_EMAIL`, which must be in `ALLOWED_EMAILS`.

## Related

[Security and privacy](security-privacy.md) · `SPEC.md` §14, §27
