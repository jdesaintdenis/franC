CREATE TABLE "category_budgets" (
	"category_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_budgets_amount_positive_check" CHECK ("category_budgets"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "category_budgets" ADD CONSTRAINT "category_budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_budgets" ADD CONSTRAINT "category_budgets_category_fk" FOREIGN KEY ("category_id","user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_budgets_user_id_idx" ON "category_budgets" USING btree ("user_id");