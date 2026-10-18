CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_id_user_id_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "transaction_tags" (
	"transaction_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "transaction_tags_pk" PRIMARY KEY("transaction_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_transaction_fk" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_tag_fk" FOREIGN KEY ("tag_id","user_id") REFERENCES "public"."tags"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_id_lower_name_unique" ON "tags" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "transaction_tags_user_id_tag_id_idx" ON "transaction_tags" USING btree ("user_id","tag_id");