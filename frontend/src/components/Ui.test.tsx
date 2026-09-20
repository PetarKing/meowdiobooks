import { createRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, Choice, InspectorDialog } from "./Ui";

describe("shared actions", () => {
  it("preserves native disabled, submit and ref behavior without accidental form submission", () => {
    const submit = vi.fn((event) => event.preventDefault());
    const action = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(
      <form onSubmit={submit}>
        <Button ref={ref} onClick={action}>
          Preview
        </Button>
        <Button type="submit" variant="ghost">
          Save
        </Button>
        <Button disabled onClick={action}>
          Unavailable
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    expect(ref.current).toBe(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Unavailable" }));
    expect(action).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("shares action variants while preserving specialized control styling", () => {
    render(
      <>
        <Button compact className="page-action">
          Continue
        </Button>
        <Button variant="ghost">Back</Button>
        <Button variant="unstyled" className="cast-tile">
          Alice
        </Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Continue" })).toHaveClass(
      "primary",
      "compact",
      "page-action",
    );
    expect(screen.getByRole("button", { name: "Back" })).toHaveClass("ghost");
    expect(screen.getByRole("button", { name: "Alice" })).not.toHaveClass(
      "primary",
      "ghost",
    );
  });
});

describe("shared inspector dialog", () => {
  it("enters the dialog, contains keyboard focus, closes on Escape and restores its trigger", () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Inspect Alice</Button>
          <Button>Background action</Button>
          {open && (
            <InspectorDialog
              label="Inspect Alice"
              closing={false}
              onClose={() => setOpen(false)}
              onClosed={() => setOpen(false)}
            >
              <Button onClick={() => setOpen(false)}>Close</Button>
              <input aria-label="Name" />
              <Button>Confirm</Button>
            </InspectorDialog>
          )}
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Inspect Alice" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    const first = screen.getByRole("button", { name: "Close" });
    const last = screen.getByRole("button", { name: "Confirm" });
    expect(document.body.style.overflow).toBe("hidden");
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("retains focus during a rerender and uses the latest close callback", () => {
    const oldClose = vi.fn();
    const nextClose = vi.fn();
    const { rerender } = render(
      <InspectorDialog
        label="Voice"
        closing={false}
        onClose={oldClose}
        onClosed={vi.fn()}
      >
        <input aria-label="Search" />
      </InspectorDialog>,
    );
    const input = screen.getByRole("textbox");
    input.focus();
    rerender(
      <InspectorDialog
        label="Voice"
        closing={false}
        onClose={nextClose}
        onClosed={vi.fn()}
      >
        <input aria-label="Search" />
      </InspectorDialog>,
    );
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(nextClose).toHaveBeenCalledTimes(1);
    expect(oldClose).not.toHaveBeenCalled();
  });

  it("dismisses only backdrop clicks and finishes only its own closing animation", () => {
    const onClose = vi.fn();
    const onClosed = vi.fn();
    render(
      <InspectorDialog
        label="Inspect Alice"
        closing
        onClose={onClose}
        onClosed={onClosed}
      >
        <span>Evidence</span>
      </InspectorDialog>,
    );
    const dialog = screen.getByRole("dialog");
    const content = screen.getByText("Evidence");
    fireEvent.click(content);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.animationEnd(content);
    expect(onClosed).not.toHaveBeenCalled();
    fireEvent.animationEnd(dialog);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});

describe("shared selection semantics", () => {
  it("preserves accepted-main hover help without selecting the choice", () => {
    const select = vi.fn();
    render(<Choice title="Native" text="Extraction" detail="Source help" detailLabel="Extraction help" onClick={select} />);
    const help = screen.getByRole("button", { name: "Extraction help" });
    fireEvent.mouseEnter(help);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Source help");
    fireEvent.mouseLeave(help);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(select).not.toHaveBeenCalled();
  });
  it("exposes both selected and unselected choices after changing the selection", () => {
    function Example() {
      const [value, setValue] = useState("native");
      return (
        <>
          {["native", "layout"].map((method) => (
            <Choice
              key={method}
              title={method}
              text="Extraction"
              selected={value === method}
              onClick={() => setValue(method)}
            />
          ))}
        </>
      );
    }
    render(<Example />);
    const native = screen.getByRole("button", {
      name: "native Extraction",
      pressed: true,
    });
    const layout = screen.getByRole("button", {
      name: "layout Extraction",
      pressed: false,
    });
    fireEvent.click(layout);
    expect(layout).toHaveAttribute("aria-pressed", "true");
    expect(native).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps choice help independent from selection and exposes its tooltip", () => {
    const select = vi.fn();
    render(
      <Choice
        title="Layout aware"
        text="Keep columns in reading order"
        detail="Best for magazines and illustrated pages."
        detailLabel="About layout aware extraction"
        onClick={select}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "About layout aware extraction",
    });
    const glyph = trigger.querySelector("span");
    const tooltip = screen.getByRole("tooltip", { hidden: true });
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(tooltip).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(trigger);
    expect(select).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(tooltip).toHaveAttribute("aria-hidden", "false");

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(tooltip).toHaveAttribute("aria-hidden", "true");
  });
});
