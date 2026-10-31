import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VoiceLanguagePicker } from "./VoiceLanguagePicker";
import { DialogSurface } from "./DialogSurface";

function Harness({ close = () => {}, languages = ["english", "french", "german"] }: { close?: () => void; languages?: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const [language, setLanguage] = useState("english");
  return <DialogSurface onDismiss={expanded ? () => setExpanded(false) : close}><VoiceLanguagePicker languages={languages} language={language} onChange={setLanguage} expanded={expanded} onExpandedChange={setExpanded} /><button>Next field</button></DialogSurface>;
}
describe("Voice language dropdown", () => {
  it("supports keyboard selection and closes the list before its parent dialog", () => {
    const close = vi.fn();render(<Harness close={close} />);
    const combo=screen.getByRole("combobox");
    fireEvent.keyDown(combo,{key:"ArrowDown"});
    fireEvent.keyDown(combo,{key:"ArrowDown"});
    fireEvent.keyDown(combo,{key:"Enter"});
    expect(combo).toHaveValue("french");
    expect(combo).toHaveFocus();
    fireEvent.click(combo);
    fireEvent.keyDown(combo,{key:"Escape"});
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(combo,{key:"Escape"});expect(close).toHaveBeenCalledOnce();
  });
  it("supports typeahead, pointer selection and outside dismissal without changing selection", () => {
    render(<Harness />);const combo=screen.getByRole("combobox");
    fireEvent.keyDown(combo,{key:"g"});
    expect(combo.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option",{name:"german"}).id);
    fireEvent.click(screen.getByRole("option",{name:"german"}));expect(combo).toHaveValue("german");
    fireEvent.click(combo);fireEvent.pointerDown(screen.getByRole("button",{name:"Next field"}));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();expect(combo).toHaveValue("german");
  });
  it("does not offer an unavailable language list", () => {
    render(<Harness languages={[]} />);expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("No narration languages available.");
  });
});
