ALTER TABLE "users" ADD COLUMN "theme" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_theme_check" CHECK ("users"."theme" IN ('system', 'light', 'dark'));