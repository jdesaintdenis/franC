ALTER TYPE "public"."recurring_status" ADD VALUE 'ended';--> statement-breakpoint
ALTER TABLE "recurring" ADD COLUMN "ended_at" date;--> statement-breakpoint
ALTER TABLE "recurring" ADD COLUMN "still_active_at" date;