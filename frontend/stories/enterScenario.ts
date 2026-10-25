import { expect, userEvent, waitFor, within } from "storybook/test";
import i18n from "../src/i18n";
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
  const t = (key: string | undefined, values?: Record<string, unknown>) => {
    if (key === undefined) throw new Error(`Scenario ${scenario} has no expected heading`);
    return i18n.t(key, values);
  };
  const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = (key: string, values?: Record<string, unknown>) => new RegExp(`^${escaped(t(key, values))}`);
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  const click = async (name: string | RegExp) => {
    const control = await page.findByRole("button", { name: typeof name === "string" ? t(name) : name });
    await waitFor(() => expect(control).toBeEnabled());
    await userEvent.click(control);
  };

  if (metadata.story.surface === "library") {
    if (metadata.gatewayVariant === "library-refresh-error")
      await canvas.findByRole("button", { name: t("Library, {{count}} audiobooks", { count: 2 }), hidden: true });
    await click(prefix("Library"));
    if (metadata.gatewayVariant === "library-error")
      await expect(await canvas.findByRole("alert")).toHaveTextContent(
        t("Library could not be loaded"),
      );
    else if (metadata.gatewayVariant === "library-refresh-error")
      await expect(await canvas.findByRole("alert")).toHaveTextContent(
        t("Library could not be loaded. Try again."),
      );
    else if (metadata.gatewayVariant === "library-loading")
      await expect(
        await canvas.findByLabelText(t("Loading audiobooks")),
      ).toHaveAttribute("aria-busy", "true");
    else
      await expect(
        await canvas.findByRole("heading", { name: t(metadata.story.heading) }),
      ).toBeVisible();
    if (metadata.gatewayVariant === "library-refresh-error")
      await expect(canvas.getAllByRole("article")).toHaveLength(2);
    return;
  }

  if (metadata.gatewayVariant === "empty-books") {
    await expect(await canvas.findByText(t("Choose book"))).toBeVisible();
    return;
  }

  const book = await canvas.findByRole("button", {
    name: new RegExp(`Alice’s Adventures in Wonderland.*${escaped(t("Continue"))}`),
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
  await canvas.findByRole("navigation", { name: t("Wizard stages") });

  if (metadata.story.acceptedStageLabel) {
    await click(prefix(metadata.story.acceptedStageLabel));
    // Accepted-state stories are neutral visual references. Keep deliberate
    // keyboard focus demonstrations separate from resting page comparisons.
    (canvasElement.ownerDocument.activeElement as HTMLElement | null)?.blur();
  }

  for (const action of metadata.story.actions) {
    await runStoryAction(action);
  }

  await expect(
    await canvas.findByRole("heading", { name: t(metadata.story.heading) }),
  ).toBeVisible();
  await expect(
    canvas.getByRole("navigation", { name: t("Wizard stages") }),
  ).toBeVisible();
  if (metadata.snapshotVariant === "review-recovery") {
    await expect(canvas.getByRole("button", { name: prefix("Rebuild Dialogue") })).toBeEnabled();
    await expect(canvas.queryByRole("button", { name: prefix("Accept preview and continue") })).not.toBeInTheDocument();
  }

  async function runStoryAction(action: WorkflowScenarioAction) {
    switch (action) {
      case "scan-review":
        await click(prefix("Scan for issues"));
        return;
      case "open-final-review":
        await click(prefix("Review complete transcript"));
        await waitFor(() => expect(page.queryByText(t("Opening the transcript…"))).toBeNull());
        await expect(await page.findByText("Alice was beginning to get very tired of sitting by her sister on the bank.")).toBeVisible();
        return;
      case "design-voices":
        await click(prefix("Design the voices"));
        return;
      case "open-alice-voice":
        await click(prefix("Open {{name}} voice", { name: "Alice" }));
        await waitFor(() =>
          expect(
            page.getByRole("dialog", { name: t("{{name}} voice", { name: "Alice" }) }),
          ).toBeVisible(),
        );
        return;
      case "open-identity-inspector":
        await click(t("Inspect {{name}}", { name: "Alice & White Rabbit" }));
        await waitFor(() =>
          expect(
            page.getByRole("button", { name: t("Confirm classification") }),
          ).toBeVisible(),
        );
        return;
      case "open-new-audition":
        await click("Create a new audition");
        await waitFor(() =>
          expect(
            page.getByRole("textbox", { name: t("Performance notes") }),
          ).toBeVisible(),
        );
        return;
      case "configure-sample":
        if (page.queryByRole("button", { name: t("Create a new audition") }))
          await click("Create a new audition");
        await userEvent.click(
          await page.findByRole("radio", { name: prefix("Clone from a sample") }),
        );
        await userEvent.upload(
          await page.findByLabelText(t("Choose voice sample")),
          fixtureVoiceSample(),
        );
        await waitFor(() =>
          expect(
            page.getByRole("textbox", { name: t("Voice sample transcript") }),
          ).toHaveValue("Who in the world am I? Ah, that’s the great puzzle."),
        );
        return;
      case "create-sample":
        await click("Create sampled audition →");
        await expect(await page.findByRole("button", { name: t("Creating cloned audition…") })).toBeDisabled();
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
        await click(prefix("Open {{name}} voice", { name: "Alice & White Rabbit" }));
        await waitFor(() =>
          expect(
            page.getByRole("dialog", { name: t("{{name}} voice", { name: "Alice & White Rabbit" }) }),
          ).toBeVisible(),
        );
        if (metadata.castFixture === "layered")
          await waitFor(() =>
            expect(
              page.getByRole("button", { name: t("Confirm layered voices") }),
            ).toBeVisible(),
          );
        return;
      case "accept-default-cast":
        await click("Accept cast & voices →");
        await waitFor(() => expect(page.getByRole("dialog")).toBeVisible());
        return;
      case "export":
        await click(prefix("Export"));
        return;
      case "phase-help":
        await click(t("About {{phase}}", { phase: t("Extract") }));
        await waitFor(() => expect(page.getByRole("dialog")).toBeVisible());
        return;
      case "open-player":
        await userEvent.click(await page.findByRole("tab", { name: prefix("Generated") }));
        await click(t("Listen to {{title}}", { title: "Down the Rabbit-Hole" }));
        await waitFor(() => expect(page.getByRole("dialog")).toBeVisible());
        return;
      case "open-split":
        await click(t("Split {{title}} into shorter chapters", { title: "Down the Rabbit-Hole" }));
        await expect(
          await page.findByRole("button", { name: t("Split into ≈ {{count}} chapters", { count: 5 }) }),
        ).toBeVisible();
        return;
      case "generate-selected":
        await click(prefix("Generate {{count}} selected", { count: 3 }));
        if (metadata.gatewayVariant === "generate-failed")
          await expect(await page.findByRole("alert")).toHaveTextContent(
            "Chapter generation stopped",
          );
        else
          await waitFor(() => expect(page.getByRole("dialog")).toBeVisible());
        return;
      case "build-dialogue":
        await click(prefix("Build transcript"));
        if (metadata.snapshotVariant === "dialogue-routing-unconfigured")
          return;
        await waitFor(() => expect(page.getByRole("dialog")).toBeVisible());
        return;
    }
    action satisfies never;
  }
}
