ALTER TABLE "category_budgets" ADD COLUMN "rollover" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "category_budgets" ADD COLUMN "rollover_start" date;--> statement-breakpoint
ALTER TABLE "category_budgets" ADD COLUMN "rollover_base_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "category_budgets" ADD CONSTRAINT "category_budgets_rollover_start_check" CHECK ("category_budgets"."rollover" = false OR ("category_budgets"."rollover_start" IS NOT NULL AND extract(day from "category_budgets"."rollover_start") = 1));