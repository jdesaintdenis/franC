import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  }

  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  const localHosts = ["localhost", "127.0.0.1", "::1", "db"];
  if (!localHosts.includes(host) && process.env.FORCE_DB_RESET !== "1") {
    throw new Error(
      `Refusing to reset a non-local database (host "${host}"). Set FORCE_DB_RESET=1 if you really mean it.`,
    );
  }

  const sql = postgres(url, { max: 1 });
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  // Drizzle records applied migrations in its own schema: without this, migrate skips them all.
  await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await sql.end();

  console.log("Database schema reset.");
}

main().catch((error) => {
  console.error("Reset failed:", error);
  process.exit(1);
});
