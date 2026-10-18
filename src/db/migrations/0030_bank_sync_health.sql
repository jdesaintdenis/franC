ALTER TABLE "bank_account_links" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "failing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "identification_hash" text;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "replaces_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bank_health_notified_on" date;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_replaces_connection_id_bank_connections_id_fk" FOREIGN KEY ("replaces_connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE set null ON UPDATE no action;