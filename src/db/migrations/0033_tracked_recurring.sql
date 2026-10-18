CREATE TYPE "public"."recurring_source" AS ENUM('detected', 'manual');--> statement-breakpoint
ALTER TABLE "recurring" ADD COLUMN "source" "recurring_source" DEFAULT 'detected' NOT NULL;