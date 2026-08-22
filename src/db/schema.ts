import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * All money in this system is stored in PAISE as integers. Never floats,
 * never rupees. Display formatting happens at the edge only.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const staffRole = pgEnum("staff_role", ["ADMIN", "COUNTER", "SCANNER"]);

export const bookingChannel = pgEnum("booking_channel", ["ONLINE", "COUNTER"]);

export const bookingStatus = pgEnum("booking_status", [
  "PENDING",
  "PAID",
  "CASH_CONFIRMED",
  "FAILED",
  "CANCELLED",
  "REFUND_PENDING",
  "REFUNDED",
]);

export const ticketStatus = pgEnum("ticket_status", [
  "ACTIVE",
  "USED",
  "CANCELLED",
  "EXPIRED",
]);

export const paymentStatus = pgEnum("payment_status", [
  "PENDING",
  "SUCCESS",
  "FAILED",
  "REFUND_PENDING",
  "REFUNDED",
]);

export const deviceType = pgEnum("device_type", ["SCANNER", "COUNTER"]);

// ---------------------------------------------------------------------------
// Staff & sessions
// ---------------------------------------------------------------------------

export const staffUsers = pgTable("staff_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: staffRole("role").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Server-side sessions. Deactivating a staff member or deleting a session row
 * revokes access immediately — the reason we don't use stateless JWTs for staff.
 */
export const staffSessions = pgTable(
  "staff_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    // Only the hash of the session token is stored; the raw token lives in the cookie.
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (t) => [index("staff_sessions_staff_idx").on(t.staffId)],
);

/** Login throttling: brute-force protection for the staff login endpoint. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    username: text("username").notNull(),
    ip: text("ip"),
    successful: boolean("successful").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_username_at_idx").on(t.username, t.at)],
);

// ---------------------------------------------------------------------------
// Devices (scanner terminals, counter terminals)
// ---------------------------------------------------------------------------

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: deviceType("type").notNull(),
  // Raw API key is shown once at registration and never stored.
  apiKeyHash: text("api_key_hash").notNull().unique(),
  active: boolean("active").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncVersion: bigint("last_sync_version", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Rate categories
// ---------------------------------------------------------------------------

/**
 * Named concession rates — "School group", "Senior citizen", "Guest of the
 * park" — that the counter can sell at instead of the standard fare.
 *
 * The price lives here, in the database, precisely so the counter screen can
 * send a category and never an amount: staff choose WHO the guest is, and the
 * server decides what that costs (spec §4.3). Rates are deactivated rather than
 * deleted, because bookings sold under them must keep pointing at what they
 * were sold as.
 */
export const rateCategories = pgTable(
  "rate_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Shown on the counter button and printed on the ticket. */
    name: text("name").notNull().unique(),
    perVisitorPaise: integer("per_visitor_paise").notNull(),
    active: boolean("active").notNull().default(true),
    createdByStaffId: uuid("created_by_staff_id").references(() => staffUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("rate_categories_price_non_negative", sql`${t.perVisitorPaise} >= 0`),
    index("rate_categories_active_idx").on(t.active),
  ],
);

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Short human-readable code shown to customers, e.g. "LS7K2M9Q". */
    bookingCode: text("booking_code").notNull().unique(),
    channel: bookingChannel("channel").notNull(),
    status: bookingStatus("status").notNull().default("PENDING"),

    visitorCount: integer("visitor_count").notNull(),
    amountTotal: integer("amount_total").notNull(),
    convenienceFee: integer("convenience_fee").notNull().default(0),
    currency: text("currency").notNull().default("INR"),

    /**
     * What one visitor was charged on THIS booking. Recorded rather than
     * derived, so editing a rate category later — or changing the standard fare
     * — can never rewrite what a past sale cost.
     */
    perVisitorPaise: integer("per_visitor_paise").notNull(),
    /** Null means the standard fare was charged. */
    rateCategoryId: uuid("rate_category_id").references(() => rateCategories.id),
    /** Why a one-off price was given. Required for a custom rate, kept for audit. */
    rateNote: text("rate_note"),

    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    customerEmail: text("customer_email"),

    visitDate: date("visit_date").notNull(),

    createdByStaffId: uuid("created_by_staff_id").references(() => staffUsers.id),
    deviceId: uuid("device_id").references(() => devices.id),

    /**
     * Guards against double submission: a retried create with the same key
     * returns the original booking instead of creating a second one.
     */
    idempotencyKey: text("idempotency_key").notNull().unique(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("bookings_visitor_count_positive", sql`${t.visitorCount} > 0`),
    check("bookings_amount_non_negative", sql`${t.amountTotal} >= 0`),
    index("bookings_visit_date_idx").on(t.visitDate),
    index("bookings_phone_idx").on(t.customerPhone),
    index("bookings_created_at_idx").on(t.createdAt),
    index("bookings_status_idx").on(t.status),
    index("bookings_rate_category_idx").on(t.rateCategoryId),
  ],
);

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    provider: text("provider").notNull(),
    /** Our order id as known to the provider. Unique => order creation is idempotent. */
    providerOrderId: text("provider_order_id").notNull().unique(),
    /** Provider's payment/transaction id. Unique => a payment is recorded at most once. */
    providerPaymentId: text("provider_payment_id").unique(),
    status: paymentStatus("status").notNull().default("PENDING"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("INR"),
    /** Last raw provider payload, for reconciliation and dispute support. */
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_booking_idx").on(t.bookingId), index("payments_status_idx").on(t.status)],
);

/**
 * Append-only log of every webhook we receive, including ones that fail
 * signature verification. The unique provider_event_id is what makes webhook
 * processing idempotent: a replayed webhook hits the constraint and is ignored.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull().unique(),
    paymentId: uuid("payment_id").references(() => payments.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    eventType: text("event_type").notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    rawPayload: jsonb("raw_payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processingError: text("processing_error"),
  },
  (t) => [index("payment_events_received_idx").on(t.receivedAt)],
);

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** UNIQUE: a booking can never produce a second ticket, even under retries. */
    bookingId: uuid("booking_id")
      .notNull()
      .unique()
      .references(() => bookings.id),
    /** 256-bit random, base64url. This is the only thing the QR encodes. */
    token: text("token").notNull().unique(),
    status: ticketStatus("status").notNull().default("ACTIVE"),
    visitorCount: integer("visitor_count").notNull(),
    /** Denormalized from the booking so the scanner can pull one day's manifest cheaply. */
    visitDate: date("visit_date").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("tickets_visitor_count_positive", sql`${t.visitorCount} > 0`),
    index("tickets_visit_date_status_idx").on(t.visitDate, t.status),
  ],
);

// ---------------------------------------------------------------------------
// Boarding
// ---------------------------------------------------------------------------

export const boardingEvents = pgTable(
  "boarding_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id),
    boardedCount: integer("boarded_count").notNull(),
    staffId: uuid("staff_id").references(() => staffUsers.id),
    deviceId: uuid("device_id").references(() => devices.id),
    /**
     * UUID generated on the scanner before the event is queued. UNIQUE => replaying
     * a queued event after a reconnect or app restart can never double-board a ticket.
     */
    clientEventId: text("client_event_id").notNull().unique(),
    /** Authoritative server time. */
    boardedAt: timestamp("boarded_at", { withTimezone: true }).notNull().defaultNow(),
    /** Device-reported time. Untrusted, kept for audit only — never used for validity. */
    deviceReportedAt: timestamp("device_reported_at", { withTimezone: true }),
    createdOffline: boolean("created_offline").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("boarding_events_count_positive", sql`${t.boardedCount} > 0`),
    index("boarding_events_ticket_idx").on(t.ticketId),
    index("boarding_events_boarded_at_idx").on(t.boardedAt),
  ],
);

// ---------------------------------------------------------------------------
// Scanner sync feed
// ---------------------------------------------------------------------------

/**
 * Monotonic feed of ticket-relevant changes. Written in the SAME transaction as
 * every ticket/booking state change, so the scanner can pull incrementally with
 * `WHERE id > :since`.
 *
 * NOTE on the sequence gap hazard: bigserial ids are assigned at INSERT time but
 * only become visible at COMMIT time, so a concurrent transaction can commit a
 * lower id after a higher one is already visible. Sync therefore also re-sends
 * anything recent by created_at (see the sync query), and the scanner applies
 * changes as idempotent upserts.
 */
export const changeLog = pgTable(
  "change_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    operation: text("operation").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("change_log_created_at_idx").on(t.createdAt)],
);

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** Append-only. Nothing in the app ever issues UPDATE or DELETE against this table. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorType: text("actor_type").notNull(), // STAFF | SYSTEM | WEBHOOK | CUSTOMER
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    context: jsonb("context"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entity, t.entityId),
    index("audit_log_at_idx").on(t.at),
  ],
);

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Backing store for `rate-limiter-flexible`. Declared here rather than letting
 * the library issue DDL at runtime, so the schema is created by migration and
 * the limiter never has to fail open on a first request.
 */
export const rateLimits = pgTable("rate_limits", {
  key: varchar("key", { length: 255 }).primaryKey(),
  points: integer("points").notNull().default(0),
  expire: bigint("expire", { mode: "number" }),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type StaffUser = typeof staffUsers.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type RateCategory = typeof rateCategories.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type BoardingEvent = typeof boardingEvents.$inferSelect;

export type BookingStatus = (typeof bookingStatus.enumValues)[number];
export type TicketStatus = (typeof ticketStatus.enumValues)[number];
export type PaymentStatus = (typeof paymentStatus.enumValues)[number];
export type StaffRole = (typeof staffRole.enumValues)[number];
