CREATE TABLE "savings_goal_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "savings_goal_contributions_amount_check" CHECK ("savings_goal_contributions"."amount_cents" <> 0 AND abs("savings_goal_contributions"."amount_cents") <= 1000000000)
);
--> statement-breakpoint
CREATE TABLE "savings_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"target_cents" integer NOT NULL,
	"target_date" date,
	"icon" text,
	"account_id" uuid,
	"start_cents" integer NOT NULL,
	"start_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "savings_goals_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "savings_goals_target_check" CHECK ("savings_goals"."target_cents" > 0 AND "savings_goals"."target_cents" <= 1000000000),
	CONSTRAINT "savings_goals_name_length_check" CHECK (char_length("savings_goals"."name") BETWEEN 1 AND 60)
);
--> statement-breakpoint
ALTER TABLE "savings_goal_contributions" ADD CONSTRAINT "savings_goal_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goal_contributions" ADD CONSTRAINT "savings_goal_contributions_goal_fk" FOREIGN KEY ("goal_id","user_id") REFERENCES "public"."savings_goals"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "savings_goal_contributions_goal_id_idx" ON "savings_goal_contributions" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "savings_goals_user_id_idx" ON "savings_goals" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "savings_goals_user_id_lower_name_unique" ON "savings_goals" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "savings_goals_account_id_unique" ON "savings_goals" USING btree ("account_id") WHERE "savings_goals"."account_id" IS NOT NULL;