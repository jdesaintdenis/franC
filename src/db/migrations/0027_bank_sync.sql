CREATE TYPE "public"."import_kind" AS ENUM('csv', 'sync');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('csv', 'sync');--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "sync_from" date;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "kind" "import_kind" DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "source" "transaction_source" DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_account_external_id_unique" ON "transactions" USING btree ("account_id","external_id") WHERE "transactions"."external_id" IS NOT NULL;