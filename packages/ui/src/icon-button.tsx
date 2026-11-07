"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";
import { Tooltip } from "./tooltip.js";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** The accessible name ("View Roy Boy UK"). */
  label: string;
  /** The tooltip text when it differs from the name ("View campaign"). */
  tooltip?: string;
  icon: ReactNode;
  /** `danger` turns red on hover (delete). */
  tone?: "default" | "danger";
  /** Skip the tooltip (when the parent already explains the button). */
  noTooltip?: boolean;
}

/** A grey icon button at the right end of a row, with the spec's dark tooltip. */
export function IconButton({
  label,
  tooltip,
  icon,
  tone = "default",
  noTooltip,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/40 disabled:pointer-events-none disabled:opacity-50 [&>svg]:h-4 [&>svg]:w-4",
        tone === "danger" ? "hover:text-signal" : "hover:text-ink",
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
  return noTooltip ? button : <Tooltip content={tooltip ?? label}>{button}</Tooltip>;
}
