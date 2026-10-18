ALTER TYPE "public"."category_source" ADD VALUE 'bank';--> statement-breakpoint
CREATE TABLE "bank_category_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"bank_category" text NOT NULL,
	"bank_subcategory" text,
	"category_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_category_mappings_user_bank_unique" UNIQUE NULLS NOT DISTINCT("user_id","bank_category","bank_subcategory")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "bank_category" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "bank_subcategory" text;--> statement-breakpoint
ALTER TABLE "bank_category_mappings" ADD CONSTRAINT "bank_category_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_category_mappings" ADD CONSTRAINT "bank_category_mappings_category_fk" FOREIGN KEY ("category_id","user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_category_mappings_user_id_idx" ON "bank_category_mappings" USING btree ("user_id");