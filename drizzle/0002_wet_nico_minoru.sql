CREATE TABLE "rate_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"per_visitor_paise" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_categories_name_unique" UNIQUE("name"),
	CONSTRAINT "rate_categories_price_non_negative" CHECK ("rate_categories"."per_visitor_paise" >= 0)
);
--> statement-breakpoint
-- Added nullable, backfilled, then constrained: `ADD COLUMN ... NOT NULL` with
-- no default fails outright on a table that already holds bookings. Existing
-- rows recover their per-visitor price from what was actually charged —
-- (total - convenience fee) / visitors — so history stays truthful rather than
-- being stamped with today's fare.
ALTER TABLE "bookings" ADD COLUMN "per_visitor_paise" integer;--> statement-breakpoint
UPDATE "bookings"
   SET "per_visitor_paise" = CASE
     WHEN "visitor_count" > 0
       THEN ("amount_total" - "convenience_fee") / "visitor_count"
     ELSE 0
   END
 WHERE "per_visitor_paise" IS NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "per_visitor_paise" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "rate_category_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "rate_note" text;--> statement-breakpoint
ALTER TABLE "rate_categories" ADD CONSTRAINT "rate_categories_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_categories_active_idx" ON "rate_categories" USING btree ("active");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_rate_category_id_rate_categories_id_fk" FOREIGN KEY ("rate_category_id") REFERENCES "public"."rate_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_rate_category_idx" ON "bookings" USING btree ("rate_category_id");