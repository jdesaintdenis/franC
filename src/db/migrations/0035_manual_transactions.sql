ALTER TYPE "public"."transaction_source" ADD VALUE 'manual';--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "awaiting_bank" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "transactions_awaiting_bank_idx" ON "transactions" USING btree ("user_id","account_id") WHERE "transactions"."awaiting_bank";