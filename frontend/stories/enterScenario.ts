import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  fixtureVoiceSample,
  metadataFor,
  type ScenarioId,
  type WorkflowScenarioAction,
} from "../design-kit/fixtures";

/** Drive real controls and wait for their observable result; no readiness timers. */
export async function enterScenario(
  canvasElement: HTMLElement,
  scenario: ScenarioId,
) {
  const metadata = metadataFor(scenario);
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  const click = async (name: string | RegExp) => {
    const control = await page.findByRole("button", { name });
    await waitFor(() => expect(control).toBeEnabled());
    await userEvent.click(control);
  };

  if (metadata.story.surface === "library") {
    if (metadata.gatewayVariant === "library-refresh-error")
      await canvas.findByRole("button", { name: "Library, 2 audiobooks" });
    await click(/^Library/);
    if (metadata.gatewayVariant === "library-error")
      await expect(await canvas.findByRole("alert")).toHaveTextContent(
        "Library could not be loaded",
      );
    else if (metadata.gatewayVariant === "library-refresh-error")
      await expect(await canvas.findByRole("alert")).toHaveTextContent(
        "Library could not be loaded. Try again.",
      );
    else if (metadata.gatewayVariant === "library-loading")
      await expect(
        await canvas.findByLabelText("Loading audiobooks"),
      ).toHaveAttribute("aria-busy", "true");
    else
      await expect(
        await canvas.findByRole("heading", { name: metadata.story.heading }),
      ).toBeVisible();
    if (metadata.gatewayVariant === "library-refresh-error")
      await expect(canvas.getAllByRole("article")).toHaveLength(2);
    return;
  }

  if (metadata.gatewayVariant === "empty-books") {
    await expect(await canvas.findByText("Choose PDF")).toBeVisible();
    return;
  }

  const book = await canvas.findByRole("button", {
    name: /Alice’s Adventures in Wonderland.*Continue/,
  });

  if (
    metadata.story.surface === "home" &&
    metadata.story.actions.includes("open-delete-dialog")
  ) {
    const control = canvasElement.querySelector<HTMLButtonElement>(
      ".recent-book-delete",
    );
    await expect(control).not.toBeNull();
    await userEvent.click(control!);
    await waitFor(() => expect(page.getByRole("dialog")).toBeVisible());
    return;
  }

  if (metadata.story.surface === "home") {
    if (metadata.story.actions.includes("open-book-error")) {
      await userEvent.click(book);
      await expect(await canvas.findByRole("alert")).toHaveTextContent(
        "could not be opened",
      );
    } else {
      await expect(book).toBeVisible();
    }
    return;
  }

  await userEvent.click(book);
  await canvas.findByRole("navigation", { name: "Wizard stages" });

  if (metadata.story.acceptedStageLabel) {
    await click(new RegExp(`^${metadata.story.acceptedStageLabel} `));
    // Accepted-state stories are neutral visual references. Keep deliberate
    // keyboard focus demonstrations separate from resting page comparisons.
    (canvasElement.ownerDocument.activeElement as HTMLElement | null)?.blur();
  }

  for (const action of metadata.story.actions) {
    await runStoryAction(action);
  }

  await expect(
    await canvas.findByRole("heading", { name: metadata.story.heading }),
  ).toBeVisible();
  await expect(
    canvas.getByRole("navigation", { name: "Wizard stages" }),
  ).toBeVisible();
  if (metadata.snapshotVariant === "review-recovery") {
    await expect(canvas.getByRole("button", { name: "Rebuild Dialogue →" })).toBeEnabled();
    await expect(canvas.queryByRole("button", { name: /Accept preview and continue/ })).not.toBeInTheDocument();
  }

  async function runStoryAction(action: WorkflowScenarioAction) {
    switch (action) {
      case "scan-review":
        await click("Scan for issues →");
        return;
      case "open-final-review":
        await click(/^Review complete transcript/);
        await waitFor(() => expect(page.queryByText("Opening the transcript…")).toBeNull());
        await expect(await page.findByText("Alice was beginning to get very tired of sitting by her sister on the bank.")).toBeVisible();
        return;
      case "design-voices":
        await click(/^Design the voices/);
        return;
      case "open-alice-voice":
        await click(/^Open Alice voice/);
        await waitFor(() =>
          expect(
            page.getByRole("dialog", { name: "Alice voice" }),
          ).toBeVisible(),
        );
        return;
      case "open-identity-inspector":
        await click("Inspect Alice & White Rabbit");
        await waitFor(() =>
          expect(
            page.getByRole("button", { name: "Confirm classification" }),
          ).toBeVisible(),
        );
        return;
      case "open-new-audition":
        await click(/New audition/);
        await waitFor(() =>
          expect(
            page.getByRole("textbox", { name: "Performance notes" }),
          ).toBeVisible(),
        );
        return;
      case "configure-sample":
        await userEvent.click(
          await page.findByRole("radio", { name: /Clone from a sample/ }),
        );
        await userEvent.upload(
          await page.findByLabelText("Choose voice sample"),
          fixtureVoiceSample(),
        );
        await waitFor(() =>
          expect(
            page.getByRole("textbox", { name: "Voice sample transcript" }),
          ).toHaveValue("Who in the world am I? Ah, that’s the great puzzle."),
        );
        return;
      case "create-sample":
        await click("Create sampled audition →");
        await expect(await page.findByRole("button", { name: "Creating cloned audition…" })).toBeDisabled();
        return;
      case "open-existing-voice": {
        const summary = await waitFor(() => {
          const node = canvasElement.ownerDocument.querySelector<HTMLElement>(
            "details.existing-voice-choice summary",
          );
          expect(node).not.toBeNull();
          return node!;
        });
        await userEvent.click(summary);
        return;
      }
      case "open-layered-voice":
        await click(/^Open Alice & White Rabbit voice/);
        await waitFor(() =>
          expect(
            page.getByRole("dialog", { name: "Alice & White Rabbit voice" }),
          ).toBeVisible(),
        );
        if (metadata.castFixture === "layered")
          await waitFor(() =>
            expect(
              page.getByRole("button", { name: "Confirm layered voices" }),
            ).toBeVisible(),
          );
        return;
      case "accept-default-cast":
        await click("Accept cast & voices →");
        await waitFor(() => expect(page.getByRole("dialog")).toBeVisible());
        return;
      case "export":
        await click(/^Export /);
        return;
      case "phase-help":
        await click("About Extract");
        await waitFor(() => expect(page.getByRole("dialog")).toBeVisible());
        return;
      case "open-player":
        await click("Listen to Down the Rabbit-Hole");
        await waitFor(() => expect(page.getByRole("dialog")).toBeVisible());
        return;
      case "open-split":
        await click("Split Down the Rabbit-Hole into shorter chapters");
        await expect(
          await page.findByRole("button", { name: "Split into ≈ 5 chapters" }),
        ).toBeVisible();
        return;
      case "generate-selected":
        await click(/Generate 3 selected/);
        if (metadata.gatewayVariant === "generate-failed")
          await expect(await page.findByRole("alert")).toHaveTextContent(
            "Chapter generation stopped",
          );
        else
          await waitFor(() => expect(page.getByRole("dialog")).toBeVisible());
        return;
      case "build-dialogue":
        await click(/Build transcript/);
        if (metadata.snapshotVariant === "dialogue-routing-unconfigured")
          return;
        await waitFor(() => expect(page.getByRole("dialog")).toBeVisible());
        return;
    }
    action satisfies never;
  }
}
