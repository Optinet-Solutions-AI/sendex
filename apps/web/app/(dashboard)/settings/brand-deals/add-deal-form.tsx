"use client";

import { Button, Card, CardHeader } from "@sendex/ui";
import { useId, useState, useTransition } from "react";
import { addBrandDealAction } from "./actions";

const inputClass = "h-9 rounded-md border border-rule bg-surface px-2 text-sm";

/**
 * Add a deal, or a new price for one (D5-23). With a Scaleo offer id, every offer whose link
 * points to that Scaleo offer earns the deal by itself. A new price for the same offer and a
 * later start day keeps the old price for earlier deposits.
 */
export function AddDealForm({ today }: { today: string }) {
  const id = useId();
  const [program, setProgram] = useState("");
  const [brand, setBrand] = useState("");
  const [offer, setOffer] = useState("");
  const [cpa, setCpa] = useState("");
  const [startsOn, setStartsOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await addBrandDealAction({
        program,
        brand,
        scaleoOfferId: offer,
        cpaEur: cpa,
        startsOn,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        `Saved: ${brand} at €${cpa} per first deposit from ${startsOn}.` +
          (result.data.linked > 0 ? ` ${result.data.linked} offer(s) now earn it.` : ""),
      );
      setBrand("");
      setOffer("");
      setCpa("");
    });
  }

  const field = (label: string, key: string, node: React.ReactNode) => (
    <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-${key}`}>
      <span className="font-medium text-ink">{label}</span>
      {node}
    </label>
  );

  return (
    <Card>
      <CardHeader title="Add or change a deal" note="What the brand pays per first deposit" />
      <form
        className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_1fr_8rem_8rem_10rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {field(
          "Program",
          "program",
          <input
            id={`${id}-program`}
            className={inputClass}
            value={program}
            onChange={(e) => setProgram(e.target.value)}
            placeholder="Example Partners"
            required
          />,
        )}
        {field(
          "Brand",
          "brand",
          <input
            id={`${id}-brand`}
            className={inputClass}
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Brand A"
            required
          />,
        )}
        {field(
          "Scaleo offer id",
          "offer",
          <input
            id={`${id}-offer`}
            className={inputClass}
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            inputMode="numeric"
            placeholder="1234"
          />,
        )}
        {field(
          "CPA (€)",
          "cpa",
          <input
            id={`${id}-cpa`}
            className={inputClass}
            value={cpa}
            onChange={(e) => setCpa(e.target.value)}
            inputMode="decimal"
            placeholder="150"
            required
          />,
        )}
        {field(
          "From",
          "from",
          <input
            id={`${id}-from`}
            type="date"
            className={inputClass}
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            required
          />,
        )}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save deal"}
        </Button>
        <p className="text-xs text-muted sm:col-span-6">
          The Scaleo offer id is the number after <code>o=</code> in the offer link (e.g. 1234 in
          …/click?o=1234). Offers using that link get the deal by themselves. To change a price,
          save the same offer with the new CPA and the day it starts: earlier deposits keep the old
          price.
        </p>
      </form>
      {error ? (
        <p role="alert" className="px-4 pb-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="px-4 pb-4 text-sm text-good" data-testid="deal-notice">
          {notice}
        </p>
      ) : null}
    </Card>
  );
}
