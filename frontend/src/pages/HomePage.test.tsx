import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomePage, type HomePageModel } from "./HomePage";
import { changeAppLocale } from "../i18n";

const original = new File(["%PDF sample"], "the-play-radio-drama-script.pdf", { type: "application/pdf" });

function ImportPage({ importing = vi.fn(), busy = false }: { importing?: HomePageModel["importBook"]; busy?: boolean }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | undefined>(original);
  return <HomePage model={{
    importLimitMB: "500", books: [], booksError: false, booksLoading: false, refreshBooks: vi.fn(), busy, file, setFile, importBook: importing, deletingBookId: undefined,
    openingBookId: undefined, navigateProduct: vi.fn(), openBook: vi.fn(), setBookPendingDeletion: vi.fn(), t,
  }} />;
}

describe("Selected PDF import", () => {
  it.each(["en", "zh-CN"] as const)("shows the home heading without a studio eyebrow in %s", async locale => {
    await changeAppLocale(locale);
    try {
      render(<ImportPage />);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(locale === "en" ? "From pageto performance." : "从书页走向演绎。");
      expect(screen.queryByText("Your audiobook studio")).not.toBeInTheDocument();
      expect(screen.queryByText("你的有声书工作室")).not.toBeInTheDocument();
    } finally { await changeAppLocale("en"); }
  });
  it("replaces the chosen PDF directly, preserving the current file when the picker is cancelled", () => {
    render(<ImportPage />);
    const replacementInput = screen.getByLabelText("Choose another file");
    expect(screen.getByText(original.name)).toHaveAttribute("title", original.name);
    expect(replacementInput).toHaveAttribute("accept", ".pdf,.epub,.txt,.md,application/pdf,application/epub+zip,text/plain,text/markdown");
    fireEvent.change(replacementInput, { target: { files: [] } });
    expect(screen.getByText(original.name)).toBeInTheDocument();
    const replacement = new File(["%PDF replacement"], "a-new-script.pdf", { type: "application/pdf" });
    fireEvent.change(replacementInput, { target: { files: [replacement] } });
    expect(screen.getByText(replacement.name)).toBeInTheDocument();
    expect(screen.queryByText(original.name)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import book →" })).toBeEnabled();
  });

  it("prevents choosing another file while import is in progress", () => {
    render(<ImportPage busy />);
    expect(screen.getByLabelText("Choose another file")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import book →" })).toBeDisabled();
  });
});
