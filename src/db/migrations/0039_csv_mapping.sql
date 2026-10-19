ALTER TABLE "accounts" ADD COLUMN "csv_mapping" jsonb;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "csv_mapping_saved_at" timestamp with time zone;