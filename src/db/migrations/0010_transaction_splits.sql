CREATE TABLE "transaction_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" uuid NOT NULL,
	"category_id" uuid,
	"amount_cents" integer NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_splits_amount_nonzero_check" CHECK ("transaction_splits"."amount_cents" <> 0)
);
--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_transaction_fk" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_splits_transaction_id_idx" ON "transaction_splits" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_splits_user_id_idx" ON "transaction_splits" USING btree ("user_id");