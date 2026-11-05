import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { ToastProvider } from "@sendex/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { authMode, devAuthConfig } from "../../lib/env";
import { DevAuthBanner } from "./dev-auth-banner";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/lists", label: "Lists" },
  { href: "/reports/postbacks", label: "Reports" },
  { href: "/settings", label: "Settings" },
] as const;

/**
 * Minimal admin shell: left nav, top bar with organisation switcher and user menu. Under the
 * development auth stub the top bar shows an amber banner instead of the Clerk widgets.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const mode = authMode();
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Sendex
          </Link>
        </div>
        <nav aria-label="Main" className="flex-1 px-2 py-3">
          <ul className="space-y-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-neutral-200 bg-white px-6">
          {mode === "dev" ? (
            <DevAuthBanner config={devAuthConfig()} />
          ) : (
            <>
              <OrganizationSwitcher afterSelectOrganizationUrl="/" afterCreateOrganizationUrl="/" />
              <UserButton />
            </>
          )}
        </header>
        <main className="flex-1 p-6">
          <ToastProvider>{children}</ToastProvider>
        </main>
      </div>
    </div>
  );
}
