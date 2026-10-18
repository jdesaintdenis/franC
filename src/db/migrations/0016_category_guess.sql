ALTER TYPE "public"."category_source" ADD VALUE 'guess';--> statement-breakpoint
CREATE TABLE "rule_suggestion_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"match_type" "rule_match_type" NOT NULL,
	"pattern" text NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_suggestion_dismissals_unique" UNIQUE("user_id","match_type","pattern","category_id")
);
--> statement-breakpoint
ALTER TABLE "rule_suggestion_dismissals" ADD CONSTRAINT "rule_suggestion_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_suggestion_dismissals" ADD CONSTRAINT "rule_suggestion_dismissals_category_fk" FOREIGN KEY ("category_id","user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE cascade ON UPDATE no action;