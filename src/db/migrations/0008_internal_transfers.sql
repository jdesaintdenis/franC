ALTER TABLE "transactions" ADD CONSTRAINT "transactions_id_user_id_unique" UNIQUE("id","user_id");--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('detected', 'confirmed');--> statement-breakpoint
CREATE TABLE "transfer_rejections" (
	"user_id" text NOT NULL,
	"out_transaction_id" uuid NOT NULL,
	"in_transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_rejections_pk" PRIMARY KEY("out_transaction_id","in_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"out_transaction_id" uuid NOT NULL,
	"in_transaction_id" uuid NOT NULL,
	"status" "transfer_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_out_transaction_id_unique" UNIQUE("out_transaction_id"),
	CONSTRAINT "transfers_in_transaction_id_unique" UNIQUE("in_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "transfer_rejections" ADD CONSTRAINT "transfer_rejections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_rejections" ADD CONSTRAINT "transfer_rejections_out_transaction_fk" FOREIGN KEY ("out_transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_rejections" ADD CONSTRAINT "transfer_rejections_in_transaction_fk" FOREIGN KEY ("in_transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_out_transaction_fk" FOREIGN KEY ("out_transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_in_transaction_fk" FOREIGN KEY ("in_transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_rejections_user_id_idx" ON "transfer_rejections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transfers_user_id_idx" ON "transfers" USING btree ("user_id");
