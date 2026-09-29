import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DismissibleDetails } from "./DismissibleDetails";

describe("settings disclosure dismissal", () => {
  it("keeps internal interactions open and dismisses on an outside pointer", () => {
    const { container } = render(<><DismissibleDetails open><summary>Recipe</summary><button>Language</button></DismissibleDetails><button>Other</button></>);
    const details = container.querySelector("details")!;
    fireEvent.pointerDown(screen.getByRole("button", { name: "Language" }));
    expect(details.open).toBe(true);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Other" }));
    expect(details.open).toBe(false);
  });
  it("returns keyboard focus to the trigger on Escape", () => {
    const { container } = render(<DismissibleDetails open><summary>Recipe</summary><button>Language</button></DismissibleDetails>);
    screen.getByRole("button", { name: "Language" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector("details")!.open).toBe(false);
    expect(screen.getByText("Recipe")).toHaveFocus();
  });
});
