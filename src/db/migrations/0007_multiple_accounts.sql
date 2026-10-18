ALTER TABLE "accounts" ADD CONSTRAINT "accounts_id_user_id_unique" UNIQUE("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_id_lower_name_unique" ON "accounts" USING btree ("user_id",lower("name"));--> statement-breakpoint
ALTER TABLE "recurring" DROP CONSTRAINT "recurring_user_id_merchant_key_unique";--> statement-breakpoint
ALTER TABLE "recurring" ADD COLUMN "account_id" uuid;--> statement-breakpoint
-- Backfill: the account of the item's most recent linked transaction, else the user's oldest account.
UPDATE "recurring" r SET "account_id" = (
  SELECT t."account_id" FROM "transactions" t
  WHERE t."recurring_id" = r."id" AND t."user_id" = r."user_id"
  ORDER BY t."date" DESC, t."id" DESC
  LIMIT 1
);--> statement-breakpoint
UPDATE "recurring" r SET "account_id" = (
  SELECT a."id" FROM "accounts" a
  WHERE a."user_id" = r."user_id"
  ORDER BY a."created_at" ASC, a."id" ASC
  LIMIT 1
) WHERE r."account_id" IS NULL;--> statement-breakpoint
-- Users without any account cannot own recurring items.
DELETE FROM "recurring" WHERE "account_id" IS NULL;--> statement-breakpoint
ALTER TABLE "recurring" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_account_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_account_id_idx" ON "recurring" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_user_id_account_id_merchant_key_unique" UNIQUE("user_id","account_id","merchant_key");
