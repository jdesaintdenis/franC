ALTER TABLE "accounts" ADD COLUMN "starting_balance_cents" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "starting_balance_date" date;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "low_balance_threshold_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_starting_balance_pair_check" CHECK (("accounts"."starting_balance_cents" IS NULL) = ("accounts"."starting_balance_date" IS NULL));--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_starting_balance_bound_check" CHECK (abs("accounts"."starting_balance_cents") <= 1000000000);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_low_balance_threshold_bound_check" CHECK (abs("accounts"."low_balance_threshold_cents") <= 1000000000);