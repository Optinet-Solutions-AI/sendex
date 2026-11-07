import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "./cn.js";

export const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-neutral-900 text-white",
        secondary: "border-transparent bg-neutral-100 text-neutral-800",
        outline: "border-neutral-300 text-neutral-800",
        success: "border-transparent bg-emerald-100 text-emerald-800",
        warning: "border-transparent bg-amber-100 text-amber-900",
        destructive: "border-transparent bg-red-100 text-red-800",
        /** Green outlined "Active". */
        active: "border-good bg-transparent text-good",
        /** Red "Bad" on a contact. */
        bad: "border-transparent bg-red-100 text-red-800",
        /** Green "Sale". */
        sale: "border-transparent bg-emerald-100 text-emerald-800",
        /** Grey "Lead". */
        lead: "border-transparent bg-neutral-100 text-neutral-700",
        /** Grey monospace "SMPP" / "HTTP". */
        code: "border-rule bg-neutral-50 font-mono text-[11px] text-neutral-700",
        /** Amber "No pricing". */
        amber: "border-transparent bg-amber-100 text-amber-900",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
