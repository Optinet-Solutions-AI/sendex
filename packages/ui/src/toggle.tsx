"use client";

import * as Switch from "@radix-ui/react-switch";
import { useId } from "react";
import { cn } from "./cn.js";

export interface ToggleProps {
  label: string;
  /** Grey text beside the label, e.g. "sends immediately". */
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Hide the visible label (keeps it for screen readers). */
  labelHidden?: boolean;
  className?: string;
  name?: string;
  /** `data-testid` on the switch itself. */
  testId?: string;
}

/** A pill switch, navy when on. */
export function Toggle({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  labelHidden,
  className,
  name,
  testId,
}: ToggleProps) {
  const id = useId();
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <Switch.Root
        id={id}
        name={name}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={labelHidden ? label : undefined}
        data-testid={testId}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/40 disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-navy" : "bg-neutral-300",
        )}
      >
        <Switch.Thumb
          className={cn(
            "block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-[18px]",
          )}
        />
      </Switch.Root>
      {labelHidden ? null : (
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
      )}
      {hint ? <span className="text-sm text-muted">{hint}</span> : null}
    </div>
  );
}
