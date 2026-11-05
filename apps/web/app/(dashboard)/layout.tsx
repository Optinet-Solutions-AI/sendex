import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { type Action, can, formatEur, type Role } from "@sendex/core";
import { db, getBalanceMicro } from "@sendex/db";
import { ToastProvider } from "@sendex/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { isAuthError, requireOrg } from "../../lib/auth";
import { authMode, devAuthConfig } from "../../lib/env";
import { DevAuthBanner } from "./dev-auth-banner";

/** The balance in the header must never be stale; the shell is rendered per request. */
export const dynamic = "force-dynamic";

interface NavItem {
  href: string;
  label: string;
  /** Shown only to roles that may perform this action. */
  action?: Action;
}

const NAV: readonly NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/lists", label: "Lists" },
  { href: "/billing", label: "Billing" },
  { href: "/settings", label: "Settings" },
  { href: "/audit", label: "Audit log", action: "audit.view" },
];

interface Shell {
  role: Role;
  balanceMicro: bigint;
}

/**
 * The tenant and balance for the shell, or null when there is no session or organisation
 * yet; the page below then renders its own `AuthErrorView`, the shell just hides the extras.
 */
async function shellContext(): Promise<Shell | null> {
  try {
    const ctx = await requireOrg();
    const balanceMicro = await getBalanceMicro(db(), ctx.organisationId);
    return { role: ctx.role, balanceMicro };
  } catch (error) {
    if (isAuthError(error)) return null;
    throw error;
  }
}

/**
 * Minimal admin shell: left nav, top bar with the balance, organisation switcher and user
 * menu. Under the development auth stub the top bar shows an amber banner instead of the
 * Clerk widgets. Owner-only screens (audit log) appear in the nav only for owners.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const mode = authMode();
  const shell = await shellContext();
  const items = NAV.filter((item) => !item.action || (shell && can(shell.role, item.action)));
  const balance = shell ? (
    <Link
      href="/billing"
      data-testid="header-balance"
      className="rounded border border-neutral-200 bg-neutral-50 px-3 py-1 text-sm font-medium tabular-nums text-neutral-800 hover:bg-neutral-100"
    >
      Balance: {formatEur(shell.balanceMicro)}
    </Link>
  ) : null;
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
            {items.map((item) => (
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
        <header className="flex h-14 items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6">
          {mode === "dev" ? (
            <>
              <DevAuthBanner config={devAuthConfig()} />
              {balance}
            </>
          ) : (
            <>
              <OrganizationSwitcher afterSelectOrganizationUrl="/" afterCreateOrganizationUrl="/" />
              <div className="flex items-center gap-4">
                {balance}
                <UserButton />
              </div>
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
