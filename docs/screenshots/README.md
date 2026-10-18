# README media

Phone screenshots and the GIF used by the root `README.md`. They are generated, not drawn: `pnpm media:generate` (needs ffmpeg and an emoji font) runs `e2e/media/readme-media.spec.ts` against a production build and the fake bank, signed in as a throwaway E2E user.

Everything comes from the synthetic `docs/samples/sample-export.csv`, with its dates moved to the current month, plus a few made-up budgets and a goal. No real data, email or URL is ever on screen (the generator fails if an `@` or `localhost` is visible). Run it after the 15th of a month so the current month is well filled, then commit the new files.
