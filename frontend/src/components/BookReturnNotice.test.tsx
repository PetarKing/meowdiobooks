import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { changeAppLocale } from "../i18n";
import { BookReturnNotice } from "./BookReturnNotice";

vi.mock("./book-return/AnimatedBook", () => ({
  default: () => { throw new Error("Graphics module unavailable"); },
}));

afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await changeAppLocale("en"); });

it("keeps short restores quiet and cancels decorative work when they finish", async () => {
  vi.useFakeTimers();
  const { container, unmount } = render(<BookReturnNotice appearance="light" />);
  expect(screen.getByRole("status")).toHaveTextContent("Opening your book");
  await act(async () => { await vi.advanceTimersByTimeAsync(799); });
  expect(container.querySelector(".book-return-art, .book-return-atmosphere, canvas")).not.toBeInTheDocument();
  unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(vi.getTimerCount()).toBe(0);
});

it("adds optional art only for a sustained wait without hiding the accessible status", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { container } = render(<BookReturnNotice appearance="dark" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(container.querySelector(".book-return-art")).toBeInTheDocument();
  expect(container.querySelector(".book-return-atmosphere")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByRole("status")).toHaveTextContent("Opening your book");
});

it("keeps the localized reading status and static art when its optional graphics fail", async () => {
  // React reports a caught boundary error to the console; this is the injected failure.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await changeAppLocale("zh-CN");
  const { container } = render(<BookReturnNotice appearance="dark" />);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("正在打开你的书籍"));
  await waitFor(() => expect(container.querySelector(".book-return-static svg")).toBeInTheDocument());
  expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  expect(container.querySelector(".book-return-atmosphere")).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelectorAll("button, a, [tabindex]")).toHaveLength(0);
});
