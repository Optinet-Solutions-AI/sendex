import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { JetBrains_Mono, Public_Sans } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { authMode, missingClerkEnv } from "../lib/env";
import "./globals.css";
import { SetupRequired } from "./setup-required";

// Self-hosted by Next at build time, so the CSP's font-src 'self' holds.
const sans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans", display: "swap" });
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
const fontClass = `${sans.variable} ${mono.variable}`;

export const metadata: Metadata = {
  title: "Sendex",
  description: "SMS marketing platform",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every HTML response must be rendered per request: the middleware issues a fresh CSP nonce
  // for each one and Next tags its inline scripts with it. A page prerendered at build time
  // (the 404 page, for instance) would ship scripts without a nonce and the policy would block
  // them. See docs/engineering/security-headers.md.
  await connection();
  const mode = authMode();
  if (mode === "unconfigured") {
    return (
      <html lang="en">
        <body className={`${fontClass} min-h-screen antialiased`}>
          <SetupRequired missing={missingClerkEnv()} />
        </body>
      </html>
    );
  }
  const document = (
    <html lang="en">
      <body className={`${fontClass} min-h-screen antialiased`}>{children}</body>
    </html>
  );
  if (mode === "dev") {
    // Development stub: no Clerk session, so no provider (its components are not rendered).
    return document;
  }
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/sign-in">
      {document}
    </ClerkProvider>
  );
}
