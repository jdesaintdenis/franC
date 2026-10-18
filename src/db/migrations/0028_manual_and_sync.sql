CREATE TABLE "duplicate_candidates" (
	"user_id" text NOT NULL,
	"transaction_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_candidates_pk" PRIMARY KEY("transaction_id","candidate_id")
);
--> statement-breakpoint
CREATE TABLE "transaction_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"source" "transaction_source" NOT NULL,
	"dedupe_hash" text NOT NULL,
	"occurrence_index" integer NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_matches_dedupe_unique" UNIQUE("account_id","dedupe_hash","occurrence_index")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "ignored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_transaction_fk" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_candidate_fk" FOREIGN KEY ("candidate_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_matches" ADD CONSTRAINT "transaction_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_matches" ADD CONSTRAINT "transaction_matches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_matches" ADD CONSTRAINT "transaction_matches_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_matches" ADD CONSTRAINT "transaction_matches_transaction_fk" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duplicate_candidates_user_id_idx" ON "duplicate_candidates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transaction_matches_transaction_id_idx" ON "transaction_matches" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_matches_account_external_id_unique" ON "transaction_matches" USING btree ("account_id","external_id") WHERE "transaction_matches"."external_id" IS NOT NULL;