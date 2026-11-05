import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { missingClerkEnv } from "../lib/env";
import "./globals.css";
import { SetupRequired } from "./setup-required";

export const metadata: Metadata = {
  title: "Sendex",
  description: "SMS marketing platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const missing = missingClerkEnv();
  if (missing.length > 0) {
    return (
      <html lang="en">
        <body className="min-h-screen antialiased">
          <SetupRequired missing={missing} />
        </body>
      </html>
    );
  }
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/sign-in">
      <html lang="en">
        <body className="min-h-screen antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
