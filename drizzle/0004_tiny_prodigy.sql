CREATE TYPE "public"."counter_tender" AS ENUM('CASH', 'UPI');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "counter_tender" "counter_tender";--> statement-breakpoint
-- Every counter sale taken before this column existed was cash: the counter
-- screen had no other button. Stating that explicitly keeps the takings split
-- adding up to the total, instead of leaving an "unspecified" bucket that has
-- to be explained away on every report from here on.
--
-- RESERVED rows are deliberately skipped. They are unsold blanks in a till's
-- ticket book — nobody has handed over anything for them yet, and their tender
-- is set when the sale reconciles.
UPDATE "bookings"
   SET "counter_tender" = 'CASH'
 WHERE "channel" = 'COUNTER'
   AND "counter_tender" IS NULL
   AND "status" <> 'RESERVED';
