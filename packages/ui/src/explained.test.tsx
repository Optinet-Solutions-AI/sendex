import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Explained } from "./explained.js";
import { TooltipProvider } from "./tooltip.js";

function renderIt(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("Explained (D5-20)", () => {
  it("shows the formula and the sum with the numbers on hover", async () => {
    renderIt(
      <Explained formula="CTR = Clicks ÷ Sent" working="9 ÷ 190 = 4.74%">
        4.74%
      </Explained>,
    );
    const value = screen.getByText("4.74%");
    expect(value).toHaveAttribute("tabindex", "0");
    await userEvent.hover(value);
    const tips = await screen.findAllByText("CTR = Clicks ÷ Sent");
    expect(tips.length).toBeGreaterThan(0);
    expect((await screen.findAllByText("9 ÷ 190 = 4.74%")).length).toBeGreaterThan(0);
  });

  it("opens from the keyboard too, and shows the formula alone without a sum", async () => {
    renderIt(<Explained formula="Profit = Revenue − Cost">Profit</Explained>);
    await userEvent.tab();
    expect(screen.getByText("Profit")).toHaveFocus();
    expect((await screen.findAllByText("Profit = Revenue − Cost")).length).toBeGreaterThan(0);
  });

  it("renders just the value when there is nothing to explain", () => {
    renderIt(<Explained formula={null}>12</Explained>);
    expect(screen.getByText("12")).not.toHaveAttribute("tabindex");
  });
});

describe("Explained notes and labels inside buttons", () => {
  it("shows a note under the sum", async () => {
    renderIt(
      <Explained formula="CPS = Cost ÷ Sales" working="€40 ÷ 4 = €10" note="Cost by send day">
        €10
      </Explained>,
    );
    await userEvent.hover(screen.getByText("€10"));
    expect((await screen.findAllByText("Cost by send day")).length).toBeGreaterThan(0);
  });

  it("is not a second tab stop inside a sort button", () => {
    renderIt(
      <button type="button">
        <Explained formula="CTR = Clicks ÷ Sent" inButton>
          CTR
        </Explained>
      </button>,
    );
    expect(screen.getByText("CTR")).not.toHaveAttribute("tabindex");
  });
});
