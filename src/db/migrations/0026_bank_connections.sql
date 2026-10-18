CREATE TYPE "public"."bank_connection_status" AS ENUM('pending', 'active', 'expired', 'failed');--> statement-breakpoint
CREATE TABLE "bank_account_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"bank_account_uid" text NOT NULL,
	"display_name" text NOT NULL,
	"iban_last4" text,
	"currency" text,
	"account_id" uuid,
	"linked_at" timestamp with time zone,
	CONSTRAINT "bank_account_links_connection_uid_unique" UNIQUE("connection_id","bank_account_uid")
);
--> statement-breakpoint
CREATE TABLE "bank_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"aspsp_name" text NOT NULL,
	"aspsp_country" text NOT NULL,
	"auth_state" text,
	"session_id" text,
	"status" "bank_connection_status" DEFAULT 'pending' NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_at" timestamp with time zone,
	CONSTRAINT "bank_connections_auth_state_unique" UNIQUE("auth_state")
);
--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD CONSTRAINT "bank_account_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD CONSTRAINT "bank_account_links_connection_id_bank_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD CONSTRAINT "bank_account_links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_account_links_user_id_idx" ON "bank_account_links" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_account_links_account_id_unique" ON "bank_account_links" USING btree ("account_id") WHERE "bank_account_links"."account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "bank_connections_user_id_idx" ON "bank_connections" USING btree ("user_id");