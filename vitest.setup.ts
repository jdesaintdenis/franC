import { config } from "dotenv";

import "@testing-library/jest-dom/vitest";

config({ path: ".env.local" });

// Tests truncate tables, so they must never run against the dev database.
// No fallback to DATABASE_URL on purpose.
if (!process.env.DATABASE_URL_TEST) {
  throw new Error("DATABASE_URL_TEST is not set. Tests refuse to run without a dedicated test database.");
}
if (process.env.DATABASE_URL_TEST === process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL_TEST must differ from DATABASE_URL: tests wipe their database.");
}
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
