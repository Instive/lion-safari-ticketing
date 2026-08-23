ALTER TYPE "public"."booking_status" ADD VALUE 'RESERVED';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reserved_device_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reserved_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "sold_offline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_reserved_device_id_devices_id_fk" FOREIGN KEY ("reserved_device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_reserved_device_idx" ON "bookings" USING btree ("reserved_device_id","visit_date");