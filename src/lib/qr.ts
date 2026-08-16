import QRCode from "qrcode";

/**
 * Renders the ticket QR.
 *
 * The QR encodes the ticket token and nothing else — no name, phone, amount or
 * database id (spec §5). Error correction level Q keeps it readable on smudged
 * thermal paper and on a scratched phone screen.
 */
export function renderQrDataUrl(token: string, width = 320): Promise<string> {
  return QRCode.toDataURL(token, {
    errorCorrectionLevel: "Q",
    margin: 1,
    width,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
