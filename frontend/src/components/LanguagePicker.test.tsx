import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NarrationLanguagePicker } from "./LanguagePicker";

describe("NarrationLanguagePicker", () => {
  it("shows flags and closes after an explicit choice", () => {
    const onChange = vi.fn();
    render(<NarrationLanguagePicker languages={["english", "french"]} language="" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Narration language" });
    const details = trigger.closest("details")!;
    expect(trigger).toHaveTextContent("Choose language");
    fireEvent.click(trigger);
    expect(details).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "english" })).toHaveTextContent("🇬🇧");
    fireEvent.click(screen.getByRole("button", { name: "french" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("french");
    expect(details).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
  });
  it("shows the selected flag and supports Escape without changing language", () => {
    const onChange = vi.fn();
    render(<NarrationLanguagePicker languages={["english", "french"]} language="french" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Narration language" });
    expect(trigger).toHaveTextContent("🇫🇷french");
    fireEvent.click(trigger);
    const english = screen.getByRole("button", { name: "english" });
    english.focus();
    fireEvent.keyDown(english, { key: "Escape" });
    expect(trigger.closest("details")).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });
});
