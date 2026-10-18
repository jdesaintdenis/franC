import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      // The real "server-only" package throws unconditionally outside of
      // Next's RSC bundler condition (which vitest doesn't set), so tests
      // that import server-only modules (e.g. src/lib/auth/server.ts) would
      // fail on that import alone. Swap in a no-op for the test run.
      "server-only": new URL("./vitest.server-only-stub.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["node_modules", ".next", "e2e"],
    // DB tests share one Postgres test database and some (test-utils'
    // resetDb) TRUNCATE it wholesale, so files must not run concurrently
    // against it or they'd wipe each other's fixtures mid-test.
    fileParallelism: false,
  },
});
