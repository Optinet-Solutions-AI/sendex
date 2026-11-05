import { analyseSmsText } from "@sendex/core";

export default function HomePage() {
  const sample = analyseSmsText("Sendex is alive {{domain}}");
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Sendex</h1>
      <p className="mt-2 text-sm text-neutral-600">
        SMS marketing platform. Dashboard screens arrive with cards D1-14 onwards.
      </p>
      <p className="mt-6 font-mono text-xs text-neutral-500">
        core check: {sample.encoding} · {sample.chars} chars · {sample.parts} part
      </p>
    </main>
  );
}
