import type { WorkflowModel } from "../app/useWorkflowModel";
import { PageTitle } from "../pages/shared";

export type DialogueRecoveryPageModel = Pick<WorkflowModel, "busy" | "rebuildDialogueFromRecovery" | "snapshot" | "t">;

export function DialogueRecoveryPage({ model }: { model: DialogueRecoveryPageModel; }) {
  const { busy, rebuildDialogueFromRecovery, snapshot, t } = model;
  const recovery = snapshot?.dialogueRecovery;
  if (!recovery) return null;
  const recoveryMessage = recovery.page === undefined
    ? t("Part of the transcript could not be matched to your PDF. No audio was generated or changed.")
    : t("Part of the transcript on page {{page}} could not be matched to your PDF. No audio was generated or changed.", { page: recovery.page });
  return <>
    <PageTitle stage="review" step={t("Step 3 · Review")} title={t("Dialogue needs rebuilding")} />
    <section className="panel panel-plain">
      <p className="panel-copy">{recoveryMessage}</p>
      <p className="dialogue-recovery-note"><b>{t("What happens next")}</b><span>{t("Rebuild Dialogue with your previous settings, review the corrected transcript, and accept it. Review, Cast & voices, and later stages will then need to be completed again.")}</span></p>
      <div className="dialogue-recovery-actions"><button className="primary" disabled={busy} onClick={() => void rebuildDialogueFromRecovery()}>{busy ? t("Opening Dialogue…") : t("Rebuild Dialogue")} →</button></div>
    </section>
  </>;

}
