ALTER TYPE "public"."import_kind" ADD VALUE 'franc';--> statement-breakpoint
ALTER TYPE "public"."transaction_source" ADD VALUE 'franc';--> statement-breakpoint
CREATE TABLE "savings_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"match_type" "rule_match_type" DEFAULT 'contains' NOT NULL,
	"pattern" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "savings" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "created_from_id" uuid;--> statement-breakpoint
ALTER TABLE "savings_rules" ADD CONSTRAINT "savings_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_rules" ADD CONSTRAINT "savings_rules_account_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "savings_rules_user_id_idx" ON "savings_rules" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "savings_rules_account_lower_pattern_unique" ON "savings_rules" USING btree ("account_id",lower("pattern"));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_from_fk" FOREIGN KEY ("created_from_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_created_from_id_idx" ON "transactions" USING btree ("created_from_id");