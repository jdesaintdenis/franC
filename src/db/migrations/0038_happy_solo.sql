CREATE TABLE "backup_status" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"failing_since" timestamp with time zone,
	"last_pathname" text,
	"last_size_bytes" integer,
	CONSTRAINT "backup_status_single_row" CHECK ("backup_status"."id" = 1)
);
