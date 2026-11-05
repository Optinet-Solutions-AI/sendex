import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { authMode, missingClerkEnv } from "../lib/env";
import "./globals.css";
import { SetupRequired } from "./setup-required";

export const metadata: Metadata = {
  title: "Sendex",
  description: "SMS marketing platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const mode = authMode();
  if (mode === "unconfigured") {
    return (
      <html lang="en">
        <body className="min-h-screen antialiased">
          <SetupRequired missing={missingClerkEnv()} />
        </body>
      </html>
    );
  }
  const document = (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
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
