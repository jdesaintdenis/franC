ALTER TABLE "users" ADD COLUMN "welcome_completed_at" timestamp;--> statement-breakpoint
-- Slice 40: users who already have data never see the welcome checklist.
UPDATE "users" u SET "welcome_completed_at" = now()
WHERE EXISTS (SELECT 1 FROM "transactions" t WHERE t.user_id = u.id);
