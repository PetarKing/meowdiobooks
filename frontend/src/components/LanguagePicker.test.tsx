import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageFlags, NarrationLanguagePicker } from "./LanguagePicker";

describe("NarrationLanguagePicker", () => {
  it("uses a native choice and waits for an explicit language selection", () => {
    const onChange = vi.fn();
    const { container } = render(<NarrationLanguagePicker languages={["english", "french"]} language="" onChange={onChange} />);
    const picker = screen.getByRole("combobox", { name: "Narration language" });
    expect(picker).toHaveValue("");
    expect(screen.getByRole("option", { name: "Choose language" })).toBeDisabled();
    expect(container.querySelector(".narration-language-flag")).toHaveTextContent("🌐");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(picker, { target: { value: "french" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("french");
  });

  it("shows the selected flag without a custom blur lifecycle", () => {
    const onChange = vi.fn();
    const { container } = render(<NarrationLanguagePicker languages={["english", "french"]} language="french" onChange={onChange} />);
    const picker = screen.getByRole("combobox", { name: "Narration language" });
    expect(picker).toHaveValue("french");
    expect(container.querySelector(".narration-language-flag")).toHaveTextContent("🇫🇷");
    fireEvent.blur(picker, { relatedTarget: null });
    expect(picker).toHaveValue("french");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("explains an unavailable language list and recovers when models load", () => {
    const onChange = vi.fn();
    const { rerender } = render(<NarrationLanguagePicker languages={[]} language="" onChange={onChange} />);
    expect(screen.getByRole("combobox", { name: "Narration language" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("No narration languages available.");
    rerender(<NarrationLanguagePicker languages={["english"]} language="" onChange={onChange} />);
    const picker = screen.getByRole("combobox", { name: "Narration language" });
    expect(picker).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(picker, { target: { value: "english" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("english");
  });

  it("keeps an unavailable bound language visible without silently changing it", () => {
    const onChange = vi.fn();
    render(<NarrationLanguagePicker languages={["english"]} language="french" onChange={onChange} />);
    expect(screen.getByRole("combobox", { name: "Narration language" })).toHaveValue("french");
    expect(screen.getByRole("option", { name: "french · Unavailable" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the flag-button picker available for its other consumers", () => {
    const onChange = vi.fn();
    render(<LanguageFlags languages={["english", "french"]} language="english" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "english" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "french" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("french");
  });
});
