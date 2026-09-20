import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabList } from "./TabList";

function Example({ id = "chapters" }: { id?: string }) {
  const [value, setValue] = useState("all");
  return (
    <>
      <TabList
        label={id}
        panelId={id}
        value={value}
        items={[
          { value: "all", label: "All" },
          { value: "pending", label: "To make" },
          { value: "generated", label: "Generated" },
        ]}
        onChange={setValue}
      />
      <div id={id} role="tabpanel" aria-labelledby={`${id}-${value}`}>
        {value}
      </div>
    </>
  );
}

describe("TabList", () => {
  it("moves focus and selection together, wraps, and exposes one tab stop", () => {
    render(<Example />);
    const tabs = screen.getAllByRole("tab");
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    expect(screen.getByRole("tabpanel", { name: "To make" })).toHaveTextContent(
      "pending",
    );
    fireEvent.keyDown(tabs[1], { key: "End" });
    expect(tabs[2]).toHaveFocus();
    fireEvent.keyDown(tabs[2], { key: "ArrowRight" });
    expect(tabs[0]).toHaveFocus();
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(tabs[2]).toHaveFocus();
    fireEvent.keyDown(tabs[2], { key: "Home" });
    expect(tabs[0]).toHaveFocus();
    fireEvent.keyDown(tabs[0], { key: "Tab" });
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("keeps independent tab groups independent and supports pointer selection", () => {
    render(
      <>
        <Example id="one" />
        <Example id="two" />
      </>,
    );
    const first = within(screen.getByRole("tablist", { name: "one" }));
    const second = within(screen.getByRole("tablist", { name: "two" }));
    fireEvent.click(first.getByRole("tab", { name: "Generated" }));
    expect(first.getByRole("tab", { name: "Generated" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(second.getByRole("tab", { name: "All" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("tabpanel", { name: "Generated" }),
    ).toHaveTextContent("generated");
  });
});
