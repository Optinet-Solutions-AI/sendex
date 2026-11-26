import { Explained } from "@sendex/ui";
import type { Figure } from "./explain";

/** A computed figure that shows its formula and working on hover (D5-20). */
export function FigureText({ figure, className }: { figure: Figure; className?: string }) {
  return (
    <Explained
      formula={figure.formula}
      working={figure.working}
      note={figure.note}
      {...(className ? { className } : {})}
    >
      {figure.text}
    </Explained>
  );
}
