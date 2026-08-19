import dynamicImport from "next/dynamic";

import { requirePageStaff } from "@/lib/auth/guards";

export const metadata = {
  title: "Gate Scanner — Lion Safari",
};

export const dynamic = "force-dynamic";

// The scanner is entirely client-side: camera, IndexedDB cache and the offline
// queue all live on the device.
const ScannerApp = dynamicImport(() =>
  import("./scanner-app").then((m) => ({ default: m.ScannerApp })),
);

export default async function ScannerPage() {
  // Defence in depth on top of the device key the /api/scanner routes require:
  // the key alone should not be enough to open the gate UI on a stray device.
  // This page is deliberately outside the (staff) group so it keeps its own
  // full-screen dark chrome instead of inheriting the staff nav header.
  await requirePageStaff(["SCANNER"]);
  return <ScannerApp />;
}
