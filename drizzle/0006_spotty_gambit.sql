CREATE TABLE "park_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"offline_selling_enabled" boolean DEFAULT true NOT NULL,
	"updated_by_staff_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "park_settings_single_row" CHECK ("park_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "park_settings" ADD CONSTRAINT "park_settings_updated_by_staff_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;