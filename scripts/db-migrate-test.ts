import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error("DATABASE_URL_TEST is not set. Copy .env.example to .env.local.");
  }

  const migrationClient = postgres(url, { max: 1 });
  const db = drizzle(migrationClient);

  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  await migrationClient.end();

  console.log("Test database migrations applied.");
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
