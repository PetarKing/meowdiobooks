import { createRef, useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DialogSurface } from "./DialogSurface";
import { Button } from "./Ui";

describe("shared modal surface", () => {
  it("leaves initial focus in the topmost modal when nested modals mount together", () => {
    render(
      <DialogSurface aria-label="Outer">
        <Button>Outer action</Button>
        <DialogSurface aria-label="Inner">
          <Button>Inner action</Button>
        </DialogSurface>
      </DialogSurface>,
    );
    expect(screen.getByRole("dialog", { name: "Inner" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Inner action" })).toHaveFocus();
  });
  it("retains scroll locking when sibling dialogs unmount out of order", () => {
    document.body.style.overflow = "scroll";
    const first = render(<DialogSurface aria-label="First"><button>First action</button></DialogSurface>);
    const second = render(<DialogSurface aria-label="Second"><button>Second action</button></DialogSurface>);
    first.unmount();
    expect(document.body.style.overflow).toBe("hidden");
    second.unmount();
    expect(document.body.style.overflow).toBe("scroll");
    document.body.style.overflow = "";
  });
  it("keeps progress focused and does not turn Escape into cancellation", () => {
    const cancel = vi.fn();
    render(
      <DialogSurface as="div" aria-label="Generation">
        <p>Working</p>
        <Button disabled onClick={cancel}>
          Cancelling
        </Button>
      </DialogSurface>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.tagName).toBe("DIV");
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).toHaveFocus();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("locks scroll by default for modal lifecycle and restores prior state", () => {
    const target = createRef<HTMLDivElement>();
    document.body.style.overflow = "auto";
    const { unmount } = render(
      <DialogSurface aria-label="Generation" initialFocusRef={target}>
        <div ref={target} tabIndex={-1}>
          Generating chapters
        </div>
        <Button>Cancel job</Button>
      </DialogSurface>,
    );
    expect(target.current).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(target.current!, { key: "Tab" });
    // Native browser traversal moves from this inner focus target to the control.
    unmount();
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });

  it("supports a passive progress opt-out without changing scroll state", () => {
    document.body.style.overflow = "auto";
    const { unmount } = render(
      <DialogSurface aria-label="Background processing" lockScroll={false}>
        <p>Working in the background</p>
      </DialogSurface>,
    );
    expect(document.body.style.overflow).toBe("auto");
    unmount();
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });

  it("lets only the topmost nested modal consume Escape and restores its opener", () => {
    const outerDismiss = vi.fn();
    function Example() {
      const [nested, setNested] = useState(false);
      return (
        <DialogSurface aria-label="Voice inspector" onDismiss={outerDismiss}>
          <Button onClick={() => setNested(true)}>Open confirmation</Button>
          {nested && (
            <DialogSurface
              aria-label="Confirm"
              onDismiss={() => setNested(false)}
            >
              <Button>Confirm action</Button>
            </DialogSurface>
          )}
        </DialogSurface>
      );
    }
    render(<Example />);
    const opener = screen.getByRole("button", { name: "Open confirmation" });
    opener.focus();
    fireEvent.click(opener);
    const nested = screen.getByRole("dialog", { name: "Confirm" });
    expect(nested).toHaveFocus();
    fireEvent.keyDown(nested, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Confirm" }),
    ).not.toBeInTheDocument();
    expect(outerDismiss).not.toHaveBeenCalled();
    expect(opener).toHaveFocus();
    fireEvent.keyDown(opener, { key: "Escape" });
    expect(outerDismiss).toHaveBeenCalledTimes(1);
  });

  it("focuses a safe confirmation action without losing the opener", () => {
    function Example() {
      const [open, setOpen] = useState(false);
      const safeAction = useRef<HTMLButtonElement>(null);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Accept cast</Button>
          {open && (
            <DialogSurface
              aria-label="Approve defaults"
              initialFocusRef={safeAction}
              onDismiss={() => setOpen(false)}
            >
              <Button ref={safeAction} onClick={() => setOpen(false)}>
                Keep reviewing
              </Button>
              <Button>Approve remaining</Button>
            </DialogSurface>
          )}
        </>
      );
    }
    render(<Example />);
    const opener = screen.getByRole("button", { name: "Accept cast" });
    opener.focus();
    fireEvent.click(opener);
    expect(
      screen.getByRole("button", { name: "Keep reviewing" }),
    ).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("honors changing busy dismissal gates without refocusing the active control", () => {
    const close = vi.fn();
    const { rerender } = render(
      <DialogSurface aria-label="Split" onDismiss={close}>
        <Button>Cancel</Button>
      </DialogSurface>,
    );
    const cancel = screen.getByRole("button");
    cancel.focus();
    rerender(
      <DialogSurface aria-label="Split">
        <Button>Cancel</Button>
      </DialogSurface>,
    );
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    rerender(
      <DialogSurface aria-label="Split" onDismiss={close}>
        <Button>Cancel</Button>
      </DialogSurface>,
    );
    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
