import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { snapshotFor } from "../../design-kit/fixtures";
import type { DialogueAttributionTarget, DialogueStrategy } from "../api/contracts";
import { DialoguePage, type DialoguePageModel } from "./DialoguePage";

function Scopes({ unlabeled = 3, unknown = 2, request = vi.fn() }: { unlabeled?: number; unknown?: number; request?: DialoguePageModel["requestDialogueTranscript"] }) {
  const { t } = useTranslation();
  const snapshot = snapshotFor("dialogue");
  const [dialogue, setDialogue] = useState({ ...snapshot.dialogue!, summary: { ...snapshot.dialogue!.summary, unlabeledCandidates: unlabeled, openSpeakerTurns: unknown } });
  const [dialogueStrategy, setDialogueStrategy] = useState<DialogueStrategy>("fill-gaps");
  const [attributionTargets, setAttributionTargets] = useState<DialogueAttributionTarget[]>(["unlabelled-candidates"]);
  return <DialoguePage model={{
    snapshot, dialogue, setDialogue, dialogueStrategy, setDialogueStrategy, attributionTargets, setAttributionTargets,
    busy: false, capabilities: { localDialogueAttribution: true, showExecutionBadge: true, showProviderCostReceipts: false },
    completed: [], revisingStages: [], dialogueCandidate: undefined, dialogueInitialDecisions: [], dialogueRulesOpen: false,
    editingAcceptedDialogue: false, conflictChoices: {}, structuralChoices: {}, setDialogueRulesOpen: vi.fn(),
    acceptCandidate: vi.fn(), refreshDialogue: vi.fn(), reopenAcceptedDialogueReview: vi.fn(), requestDialogueTranscript: request,
    setConflictChoices: vi.fn(), setDialogueCandidate: vi.fn(), setDialogueInitialDecisions: vi.fn(), setEditingAcceptedDialogue: vi.fn(),
    setError: vi.fn(), setStructuralChoices: vi.fn(), t,
  }} />;
}

describe("Dialogue AI scope targets", () => {
  it("toggles through the whole labelled row and keeps Example independent", () => {
    render(<Scopes />);
    const checkbox = screen.getByRole("checkbox", { name: "Dialogue with no speaker label" });
    const label = checkbox.closest("label")!;
    expect(checkbox).toBeChecked();
    fireEvent.click(within(label).getByText("3 turns"));
    expect(checkbox).not.toBeChecked();
    fireEvent.click(within(label).getByText("Dialogue with no speaker label"));
    expect(checkbox).toBeChecked();
    const option = label.parentElement!;
    fireEvent.click(within(option).getByText("Example"));
    expect(checkbox).toBeChecked();
    expect(option.querySelector("details")).toHaveAttribute("open");
    expect(screen.getByText("3 detected turns will use AI.")).toBeInTheDocument();
  });

  it("selects either populated scope and preserves choices while switching to Narrator", () => {
    render(<Scopes />);
    const unknown = screen.getByRole("checkbox", { name: "Dialogue labelled as unknown" });
    fireEvent.click(unknown.closest("label")!);
    expect(unknown).toBeChecked();
    expect(screen.getByText("5 detected turns will use AI.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Use the narrator/ }));
    expect(unknown).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Suggest speakers with AI/ }));
    expect(unknown).toBeEnabled();
    expect(unknown).toBeChecked();
  });

  it("skips empty scope choices and builds the transcript without AI matching", () => {
    const request = vi.fn();
    render(<Scopes unlabeled={0} unknown={0} request={request} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText("None found")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Suggest speakers with AI/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use the narrator/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Who reads the unresolved dialogue?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dialogue detection rules" })).toBeInTheDocument();
    expect(screen.getByText("No AI speaker matching will run.")).toBeInTheDocument();
    expect(screen.getByText("Known speakers keep their voices; the narrator reads the remaining text.")).toBeInTheDocument();
    const build = screen.getByRole("button", { name: "Build transcript →" });
    expect(build).toBeEnabled();
    fireEvent.click(build);
    expect(request).toHaveBeenCalledOnce();
  });

  it("uses Narrator when all populated scopes are deselected, without an extra confirmation", () => {
    render(<Scopes unknown={0} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Dialogue with no speaker label" }));
    expect(screen.getByRole("button", { name: "Build transcript →" })).toBeEnabled();
    expect(screen.getByText("No AI speaker matching will run.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Use the narrator/ }));
    expect(screen.getByRole("button", { name: "Build transcript →" })).toBeEnabled();
    expect(screen.queryByRole("checkbox", { name: "Dialogue labelled as unknown" })).not.toBeInTheDocument();
  });
});
