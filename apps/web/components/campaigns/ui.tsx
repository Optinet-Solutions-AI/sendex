"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { CampaignStatus, LapStatus } from "./types";

/** Small plain-Tailwind primitives shared by the campaign screens. */

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-neutral-900 text-white hover:bg-neutral-700 disabled:bg-neutral-400",
  secondary:
    "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 disabled:text-neutral-400",
  danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300",
  ghost: "text-neutral-700 hover:bg-neutral-100 disabled:text-neutral-400",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const sizing = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <button
      type={type}
      className={`inline-flex items-center gap-1 rounded font-medium disabled:cursor-not-allowed ${sizing} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

const STATUS_STYLES: Record<CampaignStatus | LapStatus, string> = {
  draft: "bg-neutral-100 text-neutral-700",
  scheduled: "bg-sky-100 text-sky-800",
  sending: "bg-amber-100 text-amber-800",
  paused: "bg-orange-100 text-orange-800",
  stopped: "bg-red-100 text-red-800",
  completed: "bg-emerald-100 text-emerald-800",
  queued: "bg-sky-100 text-sky-800",
  done: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: CampaignStatus | LapStatus }) {
  return (
    <span
      data-status={status}
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  name,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={name}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50 ${checked ? "bg-emerald-500" : "bg-neutral-300"}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${checked ? "translate-x-4" : "translate-x-0.5"}`}
      />
    </button>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className={`m-auto w-full rounded-lg border border-neutral-200 bg-white p-0 shadow-xl backdrop:bg-black/30 ${wide ? "max-w-3xl" : "max-w-lg"}`}
    >
      {open ? (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded px-2 text-neutral-500 hover:bg-neutral-100"
            >
              ×
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium uppercase text-neutral-500">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  "w-full rounded border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-neutral-500 focus:outline-none disabled:bg-neutral-100";

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700"
    >
      {error}
    </p>
  );
}

export function Panel({
  title,
  action,
  children,
  testId,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className="rounded border border-neutral-200 bg-white">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Chips({
  items,
  onPick,
}: {
  items: readonly { key: string; token: string; title?: string }[];
  onPick: (token: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          title={item.title}
          onClick={() => onPick(item.token)}
          className="rounded-full border border-neutral-300 bg-neutral-50 px-2 py-0.5 font-mono text-xs text-neutral-700 hover:bg-neutral-200"
        >
          {item.token}
        </button>
      ))}
    </div>
  );
}
