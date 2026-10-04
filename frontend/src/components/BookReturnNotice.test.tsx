import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { changeAppLocale } from "../i18n";
import { BookReturnNotice } from "./BookReturnNotice";

vi.mock("./book-return/AnimatedBook", () => ({
  default: () => { throw new Error("Graphics module unavailable"); },
}));

afterEach(async () => { vi.restoreAllMocks(); await changeAppLocale("en"); });

it("keeps the localized reading status without decoration when its optional graphics fail", async () => {
  // React reports a caught boundary error to the console; this is the injected failure.
  const caught = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await changeAppLocale("zh-CN");
  const { container } = render(<BookReturnNotice appearance="dark" />);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("正在打开你的书籍"));
  await waitFor(() => expect(caught).toHaveBeenCalled());
  expect(container.querySelector(".book-return-static, .book-return-3d, canvas")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  expect(container.querySelector(".book-return-atmosphere")).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelectorAll("button, a, [tabindex]")).toHaveLength(0);
});
