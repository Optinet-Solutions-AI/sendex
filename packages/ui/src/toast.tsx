"use client";

import { Check, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "./cn.js";

export type ToastVariant = "default" | "success" | "error";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Milliseconds before it disappears; 0 keeps it until dismissed. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Wrap the app once; `useToast()` then works anywhere below. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId.current;
      nextId.current += 1;
      setItems((current) => [...current, { ...input, id }]);
      const duration = input.duration ?? 5_000;
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed top-4 right-4 z-50 flex w-80 flex-col gap-2"
      >
        {items.map((item) => (
          <output
            key={item.id}
            data-testid="toast"
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-md border p-3 text-sm shadow-md",
              item.variant === "success" && "border-emerald-200 bg-good-soft",
              item.variant === "error" && "border-red-200 bg-red-50",
              (item.variant ?? "default") === "default" && "border-rule bg-surface",
            )}
          >
            {item.variant === "success" ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden="true" />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-neutral-900">{item.title}</p>
              {item.description ? (
                <p className="mt-0.5 text-neutral-600">{item.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              className="opacity-60 hover:opacity-100"
              onClick={() => dismiss(item.id)}
            >
              <X className="h-4 w-4" />
            </button>
          </output>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
