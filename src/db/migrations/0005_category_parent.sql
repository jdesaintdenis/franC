ALTER TABLE "categories" DROP CONSTRAINT "categories_user_id_name_unique";--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_id_user_id_unique" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_fk" FOREIGN KEY ("parent_id","user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_parent_id_name_unique" UNIQUE NULLS NOT DISTINCT("user_id","parent_id","name");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_not_self_check" CHECK ("categories"."parent_id" <> "categories"."id");