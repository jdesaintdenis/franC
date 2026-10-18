ALTER TABLE "recurring" ADD CONSTRAINT "recurring_id_user_id_unique" UNIQUE("id","user_id");--> statement-breakpoint
CREATE TYPE "public"."price_alert_status" AS ENUM('open', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TABLE "recurring_price_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"recurring_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"old_amount_cents" integer NOT NULL,
	"new_amount_cents" integer NOT NULL,
	"charged_on" date NOT NULL,
	"status" "price_alert_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "recurring_price_alerts_recurring_id_transaction_id_unique" UNIQUE("recurring_id","transaction_id")
);
--> statement-breakpoint
ALTER TABLE "recurring_price_alerts" ADD CONSTRAINT "recurring_price_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_price_alerts" ADD CONSTRAINT "recurring_price_alerts_recurring_fk" FOREIGN KEY ("recurring_id","user_id") REFERENCES "public"."recurring"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_price_alerts" ADD CONSTRAINT "recurring_price_alerts_transaction_fk" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_price_alerts_user_id_idx" ON "recurring_price_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_price_alerts_one_open_idx" ON "recurring_price_alerts" USING btree ("recurring_id") WHERE "recurring_price_alerts"."status" = 'open';