"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { enquiryStatus } from "@/db/schema";
import { updateGroupEnquiry } from "@/domain/enquiry";
import { DomainError } from "@/domain/errors";
import { requireStaff } from "@/lib/auth/guards";

export type EnquiryUpdateState = { error?: string; success?: string };

const schema = z.object({
  id: z.uuid(),
  status: z.enum(enquiryStatus.enumValues),
  staffNote: z.string().trim().max(2000).optional().or(z.literal("")),
});

/** Records who is handling an enquiry and what was agreed. */
export async function updateEnquiryAction(
  _prev: EnquiryUpdateState,
  formData: FormData,
): Promise<EnquiryUpdateState> {
  const staff = await requireStaff(["ADMIN"]);

  const parsed = schema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
    staffNote: formData.get("staffNote"),
  });

  if (!parsed.success) return { error: "Please check the details and try again." };

  try {
    await updateGroupEnquiry(
      parsed.data.id,
      {
        status: parsed.data.status,
        staffNote: parsed.data.staffNote ? parsed.data.staffNote : null,
      },
      { type: "STAFF", id: staff.id, name: staff.name },
    );
    revalidatePath("/admin/enquiries");
    return { success: "Enquiry updated." };
  } catch (err) {
    if (err instanceof DomainError) return { error: err.userMessage };
    console.error("[admin] enquiry update failed", err);
    return { error: "Could not update this enquiry." };
  }
}
