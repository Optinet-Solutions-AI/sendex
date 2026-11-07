import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CountryMultiSelect } from "./country-multi-select.js";

const countries = [
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "MT", name: "Malta" },
];

describe("CountryMultiSelect", () => {
  it("reads All countries when nothing is excluded and opens a searchable checklist", async () => {
    const onChange = vi.fn();
    render(<CountryMultiSelect countries={countries} value={[]} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: /All countries/ });
    await userEvent.click(trigger);
    const search = await screen.findByPlaceholderText("Search countries…");
    expect(screen.getByRole("checkbox", { name: "All countries" })).toBeChecked();
    await userEvent.type(search, "mal");
    expect(screen.getByRole("checkbox", { name: /Malta/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Germany/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Malta/ }));
    expect(onChange).toHaveBeenCalledWith(["MT"]);
  });

  it("shows the selection on the trigger and clears it with All countries", async () => {
    const onChange = vi.fn();
    render(<CountryMultiSelect countries={countries} value={["DE", "MT"]} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: /2 countries/ });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("checkbox", { name: "All countries" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
