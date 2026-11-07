import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { type Action, can, formatEur, type Role } from "@sendex/core";
import { db, getBalanceMicro } from "@sendex/db";
import { ToastProvider, TooltipProvider } from "@sendex/ui";
import { CircleHelp } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { flattenNav, visibleNav } from "../../components/shell/nav";
import { Rail } from "../../components/shell/rail";
import { SearchPalette } from "../../components/shell/search-palette";
import { isAuthError, requireOrg } from "../../lib/auth";
import { authMode, devAuthConfig } from "../../lib/env";
import { AlertsBanner } from "./alerts-banner";
import { DevAuthBanner } from "./dev-auth-banner";
import { EmergencyStopBanner } from "./emergency-stop-banner";

/** The balance in the header must never be stale; the shell is rendered per request. */
export const dynamic = "force-dynamic";

interface Shell {
  organisationId: string;
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
    return { organisationId: ctx.organisationId, role: ctx.role, balanceMicro };
  } catch (error) {
    if (isAuthError(error)) return null;
    throw error;
  }
}

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL;

/**
 * The app shell of the spec: a dark icon rail on the left that expands on hover, a white top
 * bar with the product tab, the page search, help, the balance and the user menu, and the
 * grey page underneath. Under the development auth stub the top bar shows an amber banner
 * instead of the Clerk widgets. Pages a role may not open are left out of the rail.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const mode = authMode();
  const shell = await shellContext();
  const allowed = (action: Action) => Boolean(shell && can(shell.role, action));
  const tree = visibleNav(allowed);
  const pages = flattenNav(tree);
  const balance = shell ? (
    <Link
      href="/billing"
      data-testid="header-balance"
      className="rounded-md border border-rule bg-page px-3 py-1 text-sm font-medium tabular-nums text-ink hover:bg-neutral-100"
    >
      Balance: {formatEur(shell.balanceMicro)}
    </Link>
  ) : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen">
        <Rail tree={tree} brand={<Brand />} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center gap-4 border-b border-rule bg-surface pr-6 pl-6">
            <span
              className="rounded-md bg-neutral-100 px-3 py-1 text-sm font-semibold text-ink"
              aria-current="true"
              data-testid="product-tab"
            >
              SMS
            </span>
            {mode === "dev" ? <DevAuthBanner config={devAuthConfig()} /> : null}
            <div className="ml-auto flex items-center gap-3">
              <SearchPalette pages={pages} />
              {DOCS_URL ? (
                <a
                  href={DOCS_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Help"
                  className="rounded-md p-1.5 text-muted hover:bg-neutral-100 hover:text-ink"
                >
                  <CircleHelp className="h-5 w-5" aria-hidden="true" />
                </a>
              ) : null}
              {balance}
              {mode === "dev" ? null : (
                <>
                  <OrganizationSwitcher
                    afterSelectOrganizationUrl="/"
                    afterCreateOrganizationUrl="/"
                  />
                  <UserButton />
                </>
              )}
            </div>
          </header>
          {shell ? <EmergencyStopBanner organisationId={shell.organisationId} /> : null}
          <main className="flex-1 px-6 py-6">
            <ToastProvider>
              {shell ? (
                <AlertsBanner organisationId={shell.organisationId} role={shell.role} />
              ) : null}
              {children}
            </ToastProvider>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

/** A small mark for the rail: the product initial on a navy tile. */
function Brand() {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 items-center justify-center rounded-md bg-navy font-bold text-white"
    >
      S
    </span>
  );
}
