import type { Metadata, Viewport } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { headers } from "next/headers";
import { THEME_INIT_SCRIPT } from "@/components/theme-toggle";
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
  /* Two, so the browser chrome matches the page instead of staying dark
     behind a light theme. */
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
    { media: "(prefers-color-scheme: light)", color: "#fbfbfc" },
  ],
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
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${mono.variable}`}
      /* The pre-paint script stamps `data-theme` on this element before React
         hydrates, so the server's markup and the client's differ here by
         design. Without this, every page load logs a hydration mismatch for a
         difference that is the whole point of the script. */
      suppressHydrationWarning
    >
      <head>
        {/* Before first paint, so a stored choice never shows as a flash of
            the other theme. Carries the request nonce because the CSP allows
            no unnonced inline script. */}
        <script
          nonce={nonce}
          /* React deliberately does not send `nonce` to the client, so an
             explicitly set one always mismatches on hydration. */
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body>
        <div className="staging-banner" role="note">
          Development preview <span>·</span> Features and data may change
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
