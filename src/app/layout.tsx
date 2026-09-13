import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import { headers } from "next/headers";
import "./globals.css";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c0e10",
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
    <html lang="en">
      <body>
        <div className="staging-banner" role="note">
          Development preview <span>·</span> Features and data may change
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
