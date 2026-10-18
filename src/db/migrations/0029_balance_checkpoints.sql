CREATE TYPE "public"."balance_source" AS ENUM('manual', 'bank');--> statement-breakpoint
CREATE TABLE "balance_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"source" "balance_source" NOT NULL,
	"bank_name" text,
	"fetched_at" timestamp with time zone,
	"balance_type" text,
	"accepted_gap_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_checkpoints_amount_bound_check" CHECK (abs("balance_checkpoints"."amount_cents") <= 1000000000)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "booked_on" date;--> statement-breakpoint
ALTER TABLE "balance_checkpoints" ADD CONSTRAINT "balance_checkpoints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_checkpoints" ADD CONSTRAINT "balance_checkpoints_account_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_checkpoints_user_id_idx" ON "balance_checkpoints" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "balance_checkpoints_account_id_date_idx" ON "balance_checkpoints" USING btree ("account_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "balance_checkpoints_manual_unique" ON "balance_checkpoints" USING btree ("account_id") WHERE "balance_checkpoints"."source" = 'manual';--> statement-breakpoint
CREATE UNIQUE INDEX "balance_checkpoints_bank_day_unique" ON "balance_checkpoints" USING btree ("account_id","date") WHERE "balance_checkpoints"."source" = 'bank';
-- Data copy: each starting balance (the balance at the START of day D) becomes a manual checkpoint
-- at the END of day D-1, so the balance shown is unchanged. The old columns stay, unread, until a
-- later cleanup migration. No transaction, category, rule or match row is touched.
INSERT INTO "balance_checkpoints" ("user_id", "account_id", "date", "amount_cents", "source")
SELECT "user_id", "id", "starting_balance_date" - 1, "starting_balance_cents", 'manual'
FROM "accounts"
WHERE "starting_balance_cents" IS NOT NULL AND "starting_balance_date" IS NOT NULL;
