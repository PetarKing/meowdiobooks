import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import App from "../src/App";
import type { ReviewWarning } from "../src/api/contracts";
import { createFixtureGateway } from "../design-kit/fixtures";
import { enterScenario } from "./enterScenario";

// Synthetic digital-edition front matter reproduces the excessive blank spacing in the Alice report.
const gap = "\n\n\n\n";
const warnings: Record<string, ReviewWarning> = {
  url: {
    id: "web", kind: "web-address", detail: "A web address appears in this paragraph.", severity: "warning", availableActions: ["keep", "exclude"],
    occurrences: [{ id: "url", page: 1, source: "www.example.org", text: "www.example.org", contextLayout: "continuous",
      contextBefore: `A digital edition.${gap}This ebook is available online at `,
      contextAfter: `. Before using this edition, please check the conditions that apply where you live.${gap}Title: Adventures in a Strange Land${gap}Author: A Writer${gap}Language: English` }],
  },
  credits: {
    id: "front-matter", kind: "front-back-matter", detail: "Edition credits.", severity: "warning", availableActions: ["keep", "exclude"],
    occurrences: [{ id: "credits", page: 1, source: "Credits: A Reader and Another Reader", text: "Credits: A Reader and Another Reader", contextLayout: "continuous",
      contextBefore: `Language: English${gap}Other formats: www.example.org/books/11${gap}`,
      contextAfter: `${gap}*** START OF THE BOOK ***${gap}Adventures in a Strange Land${gap}by A Writer` }],
  },
  ai: {
    id: "ai", kind: "ai-cleanup", detail: "Review the suggested correction.", severity: "warning", availableActions: ["keep", "exclude", "repair"],
    occurrences: [{ id: "broken", page: 3, source: "bro-\nken", text: "bro-\nken", replacement: "broken", reason: "A word wraps across a printed line.", availableActions: ["keep", "exclude", "repair"], contextLayout: "continuous",
      contextBefore: `A different scene.${gap}Alice looked down at the `,
      contextAfter: ` watch. Its hands had stopped just before midnight.${gap}The next chapter begins elsewhere.` }],
  },
};

function CompactReviewPassages({ example = "url" }: { example?: "url" | "credits" | "ai" | "chapter" }) {
  const gateway = useMemo(() => {
    const fixture = createFixtureGateway("review");
    const original = fixture.getStageCandidate.bind(fixture);
    fixture.getStageCandidate = async (book, stage, revision) => {
      const candidate = await original(book, stage, revision);
      return stage === "review" ? Object.assign(candidate, {
        warnings: example === "chapter" ? [] : [warnings[example]],
        boundaryCandidates: example === "chapter" ? [{ id: "chapter", page: 2, source: "Chapter I", reason: "Standalone chapter heading", contextLayout: "continuous", contextBefore: `Contents${gap}Adventures in a Strange Land${gap}`, contextAfter: `${gap}Alice sat beside her sister, watching the afternoon clouds.${gap}A long later paragraph.` }] : [],
      }) : candidate;
    };
    return fixture;
  }, [example]);
  return <App gateway={gateway} />;
}

const meta = { title: "Product/Compact review passages", component: CompactReviewPassages } satisfies Meta<typeof CompactReviewPassages>;
export default meta;
type Story = StoryObj<typeof meta>;
export const WebAddress: Story = {
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    const passage = canvas.getByRole("generic", { name: "Manuscript context" });
    await expect(passage).toHaveTextContent("This ebook is available online at www.example.org. Before using this edition");
    await expect(within(passage).queryByText(/Title:/)).not.toBeInTheDocument();
    await expect(passage.querySelectorAll("p")).toHaveLength(1);
  },
};
export const StandaloneCredits: Story = {
  args: { example: "credits" },
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const passage = within(canvasElement).getByRole("generic", { name: "Manuscript context" });
    await expect(within(passage).getByText("Other formats: www.example.org/books/11")).toBeVisible();
    await expect(within(passage).getByText("*** START OF THE BOOK ***")).toBeVisible();
    await expect(within(passage).queryByText("Language: English")).not.toBeInTheDocument();
  },
};
export const AiCorrection: Story = {
  args: { example: "ai" },
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await expect(canvas.getByText("broken")).toBeVisible();
    await expect(canvas.queryByText("A different scene.")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: /^(Apply remaining AI suggestions|Apply all suggested choices)/ })).not.toBeInTheDocument();
  },
};
export const ChapterHeading: Story = {
  args: { example: "chapter" },
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const passage = within(canvasElement).getByRole("generic", { name: "Manuscript context" });
    await expect(within(passage).getByText("Chapter I")).toBeVisible();
    await expect(passage).toHaveTextContent("Alice sat beside her sister");
    await expect(passage).toHaveTextContent("A long later paragraph.");
  },
};
