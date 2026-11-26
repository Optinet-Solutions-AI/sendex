import { Explained } from "@sendex/ui";
import type { ReactNode } from "react";
import type { Explanation } from "./explain";

/**
 * A computed figure with its hover explanation (D5-20): the formula, the working with the
 * numbers on screen and an optional note. `inButton` inside a sortable header's button.
 */
export function Figure({
  explanation,
  inButton = false,
  className,
  children,
}: {
  explanation: Explanation;
  inButton?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Explained
      formula={explanation.formula}
      working={explanation.working}
      note={explanation.note}
      inButton={inButton}
      {...(className ? { className } : {})}
    >
      {children}
    </Explained>
  );
}
