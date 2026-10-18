CREATE TYPE "public"."merchant_match_type" AS ENUM('contains', 'starts_with', 'equals');--> statement-breakpoint
CREATE TABLE "merchant_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"match_type" "merchant_match_type" NOT NULL,
	"pattern" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_patterns_pattern_length_check" CHECK (char_length("merchant_patterns"."pattern") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_id_user_id_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "merchant_id" uuid;--> statement-breakpoint
ALTER TABLE "merchant_patterns" ADD CONSTRAINT "merchant_patterns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_patterns" ADD CONSTRAINT "merchant_patterns_merchant_fk" FOREIGN KEY ("merchant_id","user_id") REFERENCES "public"."merchants"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_patterns_user_id_idx" ON "merchant_patterns" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "merchant_patterns_merchant_id_idx" ON "merchant_patterns" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "merchants_user_id_idx" ON "merchants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchants_user_id_lower_name_unique" ON "merchants" USING btree ("user_id",lower("name"));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_user_id_merchant_id_idx" ON "transactions" USING btree ("user_id","merchant_id");