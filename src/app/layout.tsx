import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Bold condensed display face for the public site's poster-style headlines
// (matches the safari-brand look of the provided artwork). Staff/scanner
// screens never reference `font-display`, so this has no effect there.
const bebasNeue = Bebas_Neue({
  weight: "400",
  variable: "--font-bebas-neue",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chhatbir Zoo — Lion & Deer Safari",
  description:
    "Book your Lion & Deer Safari at Chhatbir Zoo (Mahendra Choudhary Zoological Park) online, or find a ticket you already booked.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The scanner and counter apps are fixed-layout tools, not zoomable documents.
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${bebasNeue.variable} h-full antialiased`}
    >
      <body className="font-sans min-h-full flex flex-col">{children}</body>
    </html>
  );
}
