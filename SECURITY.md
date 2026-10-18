# Security policy

## Supported versions

Only the latest `main` is supported. franC is a personal budget app that you run yourself; there
are no released versions to patch separately.

## Reporting a vulnerability

Please report it privately: on GitHub, open the repository's **Security** tab and choose
**Report a vulnerability**. Do not open a public issue or pull request for it.

Include what you found, the steps to reproduce it, and the impact you see. Do not include real
financial data.

This is a personal project: there is no bounty and replies are best effort.

## Scope

In scope: franC's own code and the setup described in `docs/deployment.md` and
`docs/self-hosting.md` (sign-in, per-user data access, CSV import, bank sync, backups).

Out of scope: Vercel, Neon and Enable Banking themselves, and a deployment someone configured
differently from the docs (for example a leaked environment variable).
