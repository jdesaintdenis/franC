CREATE TABLE "loan_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"loan_id" uuid NOT NULL,
	"date" date NOT NULL,
	"owed_cents" integer NOT NULL,
	CONSTRAINT "loan_checkpoints_owed_check" CHECK ("loan_checkpoints"."owed_cents" between 0 and 1000000000)
);
--> statement-breakpoint
CREATE TABLE "loan_payment_splits" (
	"user_id" text NOT NULL,
	"loan_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"interest_cents" integer NOT NULL,
	"insurance_cents" integer NOT NULL,
	CONSTRAINT "loan_payment_splits_loan_id_transaction_id_pk" PRIMARY KEY("loan_id","transaction_id"),
	CONSTRAINT "loan_payment_splits_interest_check" CHECK ("loan_payment_splits"."interest_cents" between 0 and 100000000),
	CONSTRAINT "loan_payment_splits_insurance_check" CHECK ("loan_payment_splits"."insurance_cents" between 0 and 100000000)
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"borrowed_cents" integer NOT NULL,
	"rate_thousandths" integer NOT NULL,
	"insurance_cents" integer,
	"insurance_rate_thousandths" integer,
	"last_payment_on" date NOT NULL,
	"current_payment_until" date,
	"recurring_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loans_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "loans_borrowed_check" CHECK ("loans"."borrowed_cents" between 1 and 1000000000),
	CONSTRAINT "loans_rate_check" CHECK ("loans"."rate_thousandths" between 0 and 30000),
	CONSTRAINT "loans_insurance_one_check" CHECK (("loans"."insurance_cents" IS NULL) <> ("loans"."insurance_rate_thousandths" IS NULL)),
	CONSTRAINT "loans_insurance_amount_check" CHECK ("loans"."insurance_cents" between 0 and 10000000),
	CONSTRAINT "loans_insurance_rate_check" CHECK ("loans"."insurance_rate_thousandths" between 0 and 5000)
);
--> statement-breakpoint
ALTER TABLE "loan_checkpoints" ADD CONSTRAINT "loan_checkpoints_loan_fk" FOREIGN KEY ("loan_id","user_id") REFERENCES "public"."loans"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payment_splits" ADD CONSTRAINT "loan_payment_splits_loan_fk" FOREIGN KEY ("loan_id","user_id") REFERENCES "public"."loans"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payment_splits" ADD CONSTRAINT "loan_payment_splits_transaction_fk" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_recurring_id_recurring_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loan_checkpoints_loan_date_unique" ON "loan_checkpoints" USING btree ("loan_id","date");--> statement-breakpoint
CREATE INDEX "loan_checkpoints_user_id_idx" ON "loan_checkpoints" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "loan_payment_splits_user_id_idx" ON "loan_payment_splits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "loans_user_id_idx" ON "loans" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "loans_user_id_lower_name_unique" ON "loans" USING btree ("user_id",lower("name"));