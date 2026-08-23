import { z } from "zod";

import { activateReservedBooking } from "@/domain/booking/reserve";
import { DomainError } from "@/domain/errors";
import { authenticateDevice, deviceUnauthorized } from "@/lib/auth/device";
import { serverNow } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const saleSchema = z.object({
  /** The blank that was sold. Also the idempotency key for this sale. */
  bookingId: z.uuid(),
  /** Who was at the till. Recorded against the sale on reconciliation. */
  staffId: z.uuid().optional(),
  rateCategoryId: z.uuid().optional(),
  customRatePaise: z.number().int().min(0).optional(),
  rateNote: z.string().trim().max(200).optional(),
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z.string().trim().max(20).optional(),
  /** Device clock at the moment of sale. Audit only. */
  soldOfflineAt: z.iso.datetime().optional(),
});

const bodySchema = z.object({ sales: z.array(saleSchema).min(1).max(200) });

export type CounterSaleResult = {
  bookingId: string;
  accepted: boolean;
  /** True when an earlier push already reconciled this sale. */
  duplicate: boolean;
  bookingCode?: string;
  reason?: string;
  message?: string;
};

/**
 * Receives sales the counter made while offline.
 *
 * Note what the device does NOT get to state: the visitor count (it is whatever
 * the blank was printed for) or the amount (recomputed here from that count and
 * the rate). The device reports which blank it sold and to whom — the money is
 * decided on the server, exactly as it is for an online counter sale (§4.3).
 *
 * Keyed by `bookingId`, so the whole queue can be resent after a flaky
 * reconnect without double-confirming anything.
 */
export async function POST(req: Request): Promise<Response> {
  const device = await authenticateDevice(req.headers);
  if (!device || device.type !== "COUNTER") return deviceUnauthorized();

  let parsed;
  try {
    parsed = bodySchema.safeParse(await req.json());
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });

  const results: CounterSaleResult[] = [];

  for (const sale of parsed.data.sales) {
    try {
      const outcome = await activateReservedBooking({
        bookingId: sale.bookingId,
        deviceId: device.id,
        rate: sale.rateCategoryId
          ? { kind: "CATEGORY", categoryId: sale.rateCategoryId }
          : sale.customRatePaise !== undefined
            ? {
                kind: "CUSTOM",
                perVisitorPaise: sale.customRatePaise,
                note: sale.rateNote ?? "",
              }
            : { kind: "STANDARD" },
        customerName: sale.customerName || null,
        customerPhone: sale.customerPhone || null,
        soldOfflineAt: sale.soldOfflineAt ?? null,
        createdByStaffId: sale.staffId ?? null,
        actor: { type: "DEVICE", id: device.id, name: device.name },
      });

      results.push({
        bookingId: sale.bookingId,
        accepted: true,
        duplicate: !outcome.activated,
        bookingCode: outcome.booking.bookingCode,
      });
    } catch (err) {
      if (err instanceof DomainError) {
        // A definitive judgement — the blank belongs to another device, or was
        // already voided. Retrying will not change it, so the device is told to
        // stop holding the sale and surface it for a human instead.
        results.push({
          bookingId: sale.bookingId,
          accepted: false,
          duplicate: false,
          reason: err.code,
          message: err.userMessage,
        });
        continue;
      }

      console.error("[counter] offline sale failed", sale.bookingId, err);
      // No reason given: transient, keep it queued and try again.
      results.push({ bookingId: sale.bookingId, accepted: false, duplicate: false });
    }
  }

  return Response.json(
    { serverTime: serverNow().toISOString(), results },
    { headers: { "cache-control": "no-store" } },
  );
}
