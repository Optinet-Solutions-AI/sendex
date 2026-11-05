import type { ClerkEnvVar } from "../lib/env";

/** Rendered instead of the app when Clerk keys are not configured. */
export function SetupRequired({ missing }: { missing: readonly ClerkEnvVar[] }) {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Sendex needs Clerk configured</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Authentication is provided by Clerk. Set the following variables in{" "}
        <code className="rounded bg-neutral-200 px-1 font-mono text-xs">.env</code> (copy{" "}
        <code className="rounded bg-neutral-200 px-1 font-mono text-xs">.env.example</code>) and
        restart the dev server.
      </p>
      <ul className="mt-6 space-y-2">
        {missing.map((name) => (
          <li key={name} className="rounded border border-neutral-300 bg-white px-3 py-2">
            <code className="font-mono text-sm">{name}</code>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-neutral-600">
        Keys live in the Clerk dashboard under API keys. Also set{" "}
        <code className="font-mono text-xs">CLERK_WEBHOOK_SECRET</code> if you want user and
        organisation changes synced to the database.
      </p>
    </main>
  );
}
