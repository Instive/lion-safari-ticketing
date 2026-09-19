CREATE TYPE "public"."enquiry_status" AS ENUM('NEW', 'CONTACTED', 'CLOSED');--> statement-breakpoint
CREATE TABLE "group_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text NOT NULL,
	"visitor_count" integer NOT NULL,
	"visit_date" date,
	"message" text,
	"status" "enquiry_status" DEFAULT 'NEW' NOT NULL,
	"staff_note" text,
	"handled_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_enquiries_count_positive" CHECK ("group_enquiries"."visitor_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "group_enquiries" ADD CONSTRAINT "group_enquiries_handled_by_staff_id_staff_users_id_fk" FOREIGN KEY ("handled_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_enquiries_status_idx" ON "group_enquiries" USING btree ("status","created_at");