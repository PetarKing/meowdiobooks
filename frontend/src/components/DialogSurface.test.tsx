import { createRef, useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DialogSurface } from "./DialogSurface";
import { DialogBackdrop } from "./DialogBackdrop";
import { PresentationRoot } from "./PresentationRoot";
import { Button } from "./Ui";

describe("shared modal surface", () => {
  it("portals outside shell stacking contexts and retains appearance and palette", () => {
    const { container } = render(<PresentationRoot appearance="dark" palette={{ paper: "#234567" }}>
      <DialogBackdrop data-testid="backdrop"><DialogSurface aria-label="Confirm"><button>Continue</button></DialogSurface></DialogBackdrop>
    </PresentationRoot>);
    const backdrop = screen.getByTestId("backdrop");
    expect(backdrop.parentElement).toBe(document.body);
    expect(container).not.toContainElement(backdrop);
    expect(backdrop).toHaveAttribute("data-appearance", "dark");
    expect(backdrop.style.getPropertyValue("--color-paper")).toBe("#234567");
  });

  it("isolates background and late siblings, blocks stray focus and restores original inert", async () => {
    const preserved = document.createElement("aside");
    preserved.setAttribute("inert", "original");
    document.body.append(preserved);
    const { unmount } = render(<><button data-testid="background">Background</button>
      <DialogBackdrop><DialogSurface aria-label="Decision"><button>Continue</button></DialogSurface></DialogBackdrop>
    </>);
    const dialog = screen.getByRole("dialog");
    expect(screen.getByTestId("background").closest("[inert]")).not.toBeNull();
    screen.getByTestId("background").focus();
    expect(dialog).toHaveFocus();
    const late = document.createElement("button");
    document.body.append(late);
    await waitFor(() => expect(late).toHaveAttribute("inert"));
    unmount();
    expect(late).not.toHaveAttribute("inert");
    expect(preserved).toHaveAttribute("inert", "original");
    late.remove();
    preserved.remove();
  });

  it("locks both document scroll containers and restores scroll position and inline priorities", () => {
    document.documentElement.style.setProperty("overflow", "auto", "important");
    document.documentElement.style.setProperty("scrollbar-gutter", "stable", "important");
    document.body.style.setProperty("position", "relative", "important");
    document.body.style.setProperty("top", "3px");
    let scrollY = 240;
    const offset = vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
    const scrollTo = vi.spyOn(window, "scrollTo");
    const { unmount } = render(<DialogSurface aria-label="Decision" />);
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-240px");
    expect(document.documentElement.style.getPropertyValue("scrollbar-gutter")).toBe("auto");
    scrollY = 0;
    unmount();
    expect(scrollTo).toHaveBeenLastCalledWith(0, 240);
    expect(document.documentElement.style.overflow).toBe("auto");
    expect(document.documentElement.style.getPropertyPriority("overflow")).toBe("important");
    expect(document.documentElement.style.getPropertyValue("scrollbar-gutter")).toBe("stable");
    expect(document.documentElement.style.getPropertyPriority("scrollbar-gutter")).toBe("important");
    expect(document.body.style.position).toBe("relative");
    expect(document.body.style.getPropertyPriority("position")).toBe("important");
    expect(document.body.style.top).toBe("3px");
    offset.mockRestore();
    scrollTo.mockRestore();
    document.documentElement.style.removeProperty("overflow");
    document.documentElement.style.removeProperty("scrollbar-gutter");
    document.body.style.removeProperty("position");
    document.body.style.removeProperty("top");
  });

  it("keeps only the last portal active and traps Shift-Tab without including hidden controls", () => {
    const first = render(<DialogBackdrop><DialogSurface aria-label="First"><button>Earlier</button></DialogSurface></DialogBackdrop>);
    const second = render(<DialogBackdrop><DialogSurface aria-label="Second"><button hidden>Hidden</button><button>Safe</button><button>Confirm</button></DialogSurface></DialogBackdrop>);
    const earlier = screen.getByText("Earlier");
    expect(earlier.closest("[inert]")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Safe" })).toHaveFocus();
    first.unmount();
    expect(document.body.style.position).toBe("fixed");
    second.unmount();
    expect(document.body.style.position).toBe("");
  });

  it("shares focus, inert isolation and scroll locks across separately bundled entry copies", async () => {
    // Re-evaluate the entry and its internal modules just as separate Vite App
    // and /ui dependency chunks do, while retaining the live first entry.
    vi.resetModules();
    const { DialogSurface: HostSurface } = await import("./DialogSurface");
    const workflow = render(<DialogSurface aria-label="Core progress"><button>Core control</button></DialogSurface>);
    const host = render(<DialogBackdrop><HostSurface aria-label="Host funding"><button>Host action</button></HostSurface></DialogBackdrop>);
    const funding = screen.getByRole("dialog", { name: "Host funding" });
    expect(funding).toHaveFocus();
    expect(funding.closest("[inert]")).toBeNull();
    workflow.unmount();
    expect(document.body.style.position).toBe("fixed");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(funding).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Host action" })).toHaveFocus();
    host.unmount();
    expect(document.body.style.position).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
  });

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
