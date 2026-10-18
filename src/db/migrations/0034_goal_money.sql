DROP INDEX "savings_goals_account_id_unique";--> statement-breakpoint
ALTER TABLE "savings_goal_contributions" ADD COLUMN "transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "savings_rules" ADD COLUMN "goal_id" uuid;--> statement-breakpoint
ALTER TABLE "savings_goal_contributions" ADD CONSTRAINT "savings_goal_contributions_transaction_fk" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_rules" ADD CONSTRAINT "savings_rules_goal_id_savings_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."savings_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "savings_goal_contributions_transaction_id_idx" ON "savings_goal_contributions" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "savings_goal_contributions_transaction_id_unique" ON "savings_goal_contributions" USING btree ("transaction_id") WHERE "savings_goal_contributions"."transaction_id" IS NOT NULL;
--> statement-breakpoint
-- Slice 55: an account goal now holds the money assigned to it. Give each existing account goal one entry
-- equal to its account's balance today (same rules as getAccountBalances), so what it has saved is unchanged.
INSERT INTO "savings_goal_contributions" ("user_id", "goal_id", "date", "amount_cents")
SELECT g."user_id", g."id", current_date, least(bal."cents", 1000000000)
FROM "savings_goals" g
JOIN "accounts" a ON a."id" = g."account_id" AND a."user_id" = g."user_id"
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN b."date" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "bank_account_links" l WHERE l."account_id" = a."id" AND l."user_id" = a."user_id"
    ) THEN b."amount_cents" + (
      SELECT coalesce(sum(t."amount_cents"), 0) FROM "transactions" t
      WHERE t."account_id" = a."id" AND t."user_id" = a."user_id" AND t."ignored_at" IS NULL
        AND coalesce(t."booked_on", t."date") > b."date"
    )
    WHEN m."date" IS NOT NULL THEN m."amount_cents" + (
      SELECT coalesce(sum(t."amount_cents"), 0) FROM "transactions" t
      WHERE t."account_id" = a."id" AND t."user_id" = a."user_id" AND t."ignored_at" IS NULL AND t."date" > m."date"
    )
  END AS "cents"
  FROM (SELECT 1) AS one
  LEFT JOIN "balance_checkpoints" m ON m."account_id" = a."id" AND m."user_id" = a."user_id" AND m."source" = 'manual'
  LEFT JOIN LATERAL (
    SELECT c."date", c."amount_cents" FROM "balance_checkpoints" c
    WHERE c."account_id" = a."id" AND c."user_id" = a."user_id" AND c."source" = 'bank'
    ORDER BY c."date" DESC LIMIT 1
  ) b ON true
) bal
WHERE g."account_id" IS NOT NULL AND bal."cents" > 0;
