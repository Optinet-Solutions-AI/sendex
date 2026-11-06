import { analyseSmsText } from "@sendex/core";
import { RequireOrg } from "./require-org";

export default function DashboardPage() {
  const sample = analyseSmsText("Sendex is alive {{domain}}");
  return (
    <RequireOrg>
      {(ctx) => (
        <section className="max-w-3xl">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-2 text-sm text-neutral-600">
            SMS marketing platform. Dashboard screens arrive with cards D1-16 onwards.
          </p>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-neutral-500">Organisation</dt>
            <dd className="font-mono text-xs">{ctx.organisationId}</dd>
            <dt className="text-neutral-500">Your role</dt>
            <dd>{ctx.role}</dd>
          </dl>
          <p className="mt-6 font-mono text-xs text-neutral-500">
            core check: {sample.encoding} · {sample.chars} chars · {sample.parts} part
          </p>
        </section>
      )}
    </RequireOrg>
  );
}
