CREATE TYPE "public"."booking_channel" AS ENUM('ONLINE', 'COUNTER');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('PENDING', 'PAID', 'CASH_CONFIRMED', 'FAILED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."device_type" AS ENUM('SCANNER', 'COUNTER');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'SUCCESS', 'FAILED', 'REFUND_PENDING', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('ADMIN', 'COUNTER', 'SCANNER');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('ACTIVE', 'USED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"context" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boarding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"boarded_count" integer NOT NULL,
	"staff_id" uuid,
	"device_id" uuid,
	"client_event_id" text NOT NULL,
	"boarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_reported_at" timestamp with time zone,
	"created_offline" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boarding_events_client_event_id_unique" UNIQUE("client_event_id"),
	CONSTRAINT "boarding_events_count_positive" CHECK ("boarding_events"."boarded_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_code" text NOT NULL,
	"channel" "booking_channel" NOT NULL,
	"status" "booking_status" DEFAULT 'PENDING' NOT NULL,
	"visitor_count" integer NOT NULL,
	"amount_total" integer NOT NULL,
	"convenience_fee" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"customer_email" text,
	"visit_date" date NOT NULL,
	"created_by_staff_id" uuid,
	"device_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_booking_code_unique" UNIQUE("booking_code"),
	CONSTRAINT "bookings_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "bookings_visitor_count_positive" CHECK ("bookings"."visitor_count" > 0),
	CONSTRAINT "bookings_amount_non_negative" CHECK ("bookings"."amount_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "change_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "device_type" NOT NULL,
	"api_key_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_api_key_hash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"ip" text,
	"successful" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"payment_id" uuid,
	"booking_id" uuid,
	"event_type" text NOT NULL,
	"signature_valid" boolean NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	CONSTRAINT "payment_events_provider_event_id_unique" UNIQUE("provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"provider_payment_id" text,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_order_id_unique" UNIQUE("provider_order_id"),
	CONSTRAINT "payments_provider_payment_id_unique" UNIQUE("provider_payment_id")
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip" text,
	CONSTRAINT "staff_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"token" text NOT NULL,
	"status" "ticket_status" DEFAULT 'ACTIVE' NOT NULL,
	"visitor_count" integer NOT NULL,
	"visit_date" date NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "tickets_token_unique" UNIQUE("token"),
	CONSTRAINT "tickets_visitor_count_positive" CHECK ("tickets"."visitor_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "boarding_events" ADD CONSTRAINT "boarding_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_events" ADD CONSTRAINT "boarding_events_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_events" ADD CONSTRAINT "boarding_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "boarding_events_ticket_idx" ON "boarding_events" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "boarding_events_boarded_at_idx" ON "boarding_events" USING btree ("boarded_at");--> statement-breakpoint
CREATE INDEX "bookings_visit_date_idx" ON "bookings" USING btree ("visit_date");--> statement-breakpoint
CREATE INDEX "bookings_phone_idx" ON "bookings" USING btree ("customer_phone");--> statement-breakpoint
CREATE INDEX "bookings_created_at_idx" ON "bookings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "change_log_created_at_idx" ON "change_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_username_at_idx" ON "login_attempts" USING btree ("username","at");--> statement-breakpoint
CREATE INDEX "payment_events_received_idx" ON "payment_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "staff_sessions_staff_idx" ON "staff_sessions" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "tickets_visit_date_status_idx" ON "tickets" USING btree ("visit_date","status");