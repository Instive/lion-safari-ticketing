import dynamicImport from "next/dynamic";

export const metadata = {
  title: "Gate Scanner — Lion Safari",
};

export const dynamic = "force-dynamic";

// The scanner is entirely client-side: camera, IndexedDB cache and the offline
// queue all live on the device.
const ScannerApp = dynamicImport(() =>
  import("./scanner-app").then((m) => ({ default: m.ScannerApp })),
);

export default function ScannerPage() {
  return <ScannerApp />;
}
