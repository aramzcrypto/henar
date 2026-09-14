import type { Metadata, Viewport } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { headers } from "next/headers";
import "./globals.css";

// Manrope carries the brand voice; the mono gives every price, ticker and mint
// the fixed-width authority a terminal needs. Both are self-hosted at build.
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0809",
};
export const metadata: Metadata = {
  title: "Henar · Tokenized equity markets on Solana",
  description:
    "One company. Every valid Solana representation. Understand and trade tokenized equities through Henar.",
  icons: { icon: "/favicon.png" },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Next reads the request CSP nonce and attaches it to its generated scripts.
  // Dynamic rendering is required so HTML and the response nonce always agree.
  await headers();
  return (
    <html lang="en" className={`${manrope.variable} ${mono.variable}`}>
      <body>
        <div className="staging-banner" role="note">
          Development preview <span>·</span> Features and data may change
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
