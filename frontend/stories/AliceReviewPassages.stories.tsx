import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import App from "../src/App";
import type { ReviewWarning } from "../src/api/contracts";
import { createFixtureGateway } from "../design-kit/fixtures";
import { enterScenario } from "./enterScenario";

// Public-domain Alice passages from https://www.gutenberg.org/ebooks/11.
// Exact source/context/replacements reproduce the reported review state; identifiers and runtime metadata are synthetic.
const passages = {
  "url": {
    "source": "www.gutenberg.org",
    "contextBefore": "The Project Gutenberg eBook of Alice's Adventures in Wonderland\n\n\n\nThis eBook is for the use of anyone anywhere in the United States and most other parts of the world at no cost and with almost no restrictions whatsoever. You may copy it, give it away or re-use it under the terms of the Project Gutenberg License included with this eBook or online at ",
    "contextAfter": ". If you are not located in the United States, you will have to check the laws of the country where you are located before using this eBook.\n\n\n\nTitle: Alice's Adventures in Wonderland\n\n\n\nAuthor: Lewis Carroll\n\n\n\nRelease date: June 27, 2008 [eBook #11]\n Most recently updated: June 26, 2025\n\n\n\nLanguage: English\n\n\n\nOther information and formats: www.gutenberg.org/ebooks/11\n\n\n\nCredits: Arthur DiBianca and David Widger\n\n\n\n *** START OF THE PROJECT GUTENBERG EBOOK ALICE'S ADVENTURES IN WONDERLAND *** \n\n\n\nAlice’s Adventures in Wonderland\n\n\n\nby Lewis Carroll\n\n\n\nTHE MILLENNIUM FULCRUM EDITION 3.0 …"
  },
  "credits": {
    "source": "Credits: Arthur DiBianca and David Widger",
    "contextBefore": "Title: Alice's Adventures in Wonderland\n\n\n\nAuthor: Lewis Carroll\n\n\n\nRelease date: June 27, 2008 [eBook #11]\n Most recently updated: June 26, 2025\n\n\n\nLanguage: English\n\n\n\nOther information and formats: www.gutenberg.org/ebooks/11\n\n\n\n",
    "contextAfter": "\n\n\n\n *** START OF THE PROJECT GUTENBERG EBOOK ALICE'S ADVENTURES IN WONDERLAND *** \n\n\n\nAlice’s Adventures in Wonderland\n\n\n\nby Lewis Carroll\n\n\n\nTHE MILLENNIUM FULCRUM EDITION 3.0\n\n\n\nContents\n\n\n\n  CHAPTER I.",
    "replacement": ""
  },
  "verse": {
    "source": "two p\n ennyworth",
    "contextBefore": "Beau—ootiful Soo—oop!\n Soo—oop of the e—e—evening,\n Beautiful, beautiful Soup!\n \n\n\n “Beautiful Soup! Who cares for fish,\n Game, or any other dish?\n Who would not give all else for ",
    "contextAfter": " only of beautiful Soup?\n Pennyworth only of beautiful Soup?\n Beau—ootiful Soo—oop!\n Beau—ootiful Soo—oop!\n Soo—oop of the e—e—evening,\n Beautiful, beauti—FUL SOUP!” \n\n\n\n “Chorus again!”",
    "replacement": "two pennyworth"
  }
};

type AliceExample = keyof typeof passages;
function AliceReviewPassages({ example = "url", multiple = false }: { example?: AliceExample; multiple?: boolean }) {
  const gateway = useMemo(() => {
    const fixture = createFixtureGateway("review");
    const original = fixture.getStageCandidate.bind(fixture);
    const warning: ReviewWarning = {
      id: "alice-review", kind: example === "url" ? "web-address" : "ai-cleanup", severity: "warning",
      detail: "Review this passage from Alice's Adventures in Wonderland.",
      availableActions: example === "url" ? ["keep", "exclude"] : ["keep", "exclude", "repair"],
      occurrences: [{ ...passages[example], id: "alice-example", page: 1, text: passages[example].source, contextLayout: "continuous",
        availableActions: example === "url" ? ["keep", "exclude"] : ["keep", "exclude", "repair"],
        reason: example === "url" ? "Web address that may not belong in the spoken edition." : example === "credits" ? "This is production credit metadata, not story text." : "Repairs an unambiguous word split across a line break." }],
    };
    if (multiple && example !== "url") warning.occurrences.push({
      ...passages.verse, id: "alice-second-example", page: 26, text: passages.verse.source,
      contextLayout: "continuous", availableActions: ["keep", "exclude", "repair"],
    });
    fixture.getStageCandidate = async (book, stage, revision) => {
      const candidate = await original(book, stage, revision);
      return stage === "review" ? Object.assign(candidate, { warnings: [warning], boundaryCandidates: [] }) : candidate;
    };
    return fixture;
  }, [example, multiple]);
  return <App gateway={gateway} />;
}

const meta = { title: "Product/Alice review passages", component: AliceReviewPassages } satisfies Meta<typeof AliceReviewPassages>;
export default meta;
type Story = StoryObj<typeof meta>;
export const WebAddress: Story = {
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const passage = within(canvasElement).getByRole("generic", { name: "Manuscript context" });
    await expect(passage).toHaveTextContent("This eBook is for the use of anyone anywhere in the United States");
    await expect(passage).toHaveTextContent("before using this eBook.");
    await expect(passage.querySelector("mark")?.textContent).toBe("www.gutenberg.org");
    await expect(within(passage).queryByText(/Author: Lewis Carroll/)).not.toBeInTheDocument();
    await expect(passage.querySelectorAll("p")).toHaveLength(1);
  },
};
export const CreditsAiSuggestion: Story = {
  args: { example: "credits" },
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    const passage = canvas.getByRole("generic", { name: "Manuscript context" });
    await expect(passage.querySelector("mark")?.textContent).toBe("Credits: Arthur DiBianca and David Widger");
    await expect(passage).toHaveTextContent("Other information and formats: www.gutenberg.org/ebooks/11");
    await expect(passage).toHaveTextContent("*** START OF THE PROJECT GUTENBERG EBOOK ALICE'S ADVENTURES IN WONDERLAND ***");
    await expect(within(passage).queryByText("Language: English")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: /^Apply all suggested choices/ })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /^Leave out(?: \(Suggested\))? This highlighted/ })).toHaveClass("review-recommended");
    await expect(canvas.queryByLabelText("Proposed correction")).not.toBeInTheDocument();
  },
};
export const VerseAiSuggestion: Story = {
  args: { example: "verse" },
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    const passage = canvas.getByRole("generic", { name: "Manuscript context" });
    await expect(passage.querySelector("mark")?.textContent).toBe("two p\n ennyworth");
    await expect(passage.textContent).toContain("“Beautiful Soup! Who cares for fish,\n Game, or any other dish?");
    await expect(within(passage).queryByText(/Chorus again/)).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Apply correction (Suggested) two pennyworth" })).toHaveClass("review-recommended");
    await expect(canvas.queryByLabelText("Proposed correction")).not.toBeInTheDocument();
  },
};

export const MultipleAiSuggestions: Story = {
  args: { example: "credits", multiple: true },
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Example 1 of 2")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Apply all suggested choices (2)" })).toBeVisible();
  },
};
