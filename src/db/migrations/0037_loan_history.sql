ALTER TABLE "loans" ADD COLUMN "started_on" date;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "amortization_from" date;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_started_on_check" CHECK ("loans"."started_on" IS NULL OR "loans"."started_on" <= "loans"."last_payment_on");--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_amortization_from_check" CHECK ("loans"."amortization_from" IS NULL OR ("loans"."started_on" IS NOT NULL AND "loans"."started_on" < "loans"."amortization_from" AND "loans"."amortization_from" <= "loans"."last_payment_on"));