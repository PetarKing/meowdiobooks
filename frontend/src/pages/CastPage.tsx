import { useState } from "react";
import { DialogSurface } from "../components/DialogSurface";
import { PhaseHelp } from "../components/PhaseHelp";
import type {
  CastArtifact,
  CastVoice,
  VoiceSettings,
} from "../api/contracts";
import type { WorkflowModel } from "../app/useWorkflowModel";
import { strongConfirmationLabelsForCast } from "../castIdentity";
import { CastIdentityReview } from "../components/CastIdentityReview";
import { CastingChoice } from "../components/CastingChoice";
import { CastVoiceReview } from "../components/CastVoiceReview";
import { NarrationLanguagePicker } from "../components/LanguagePicker";
import { draftVoiceSelection } from "../workflow/voiceSelection";
import { AcceptedSummary, PageTitle, StageLaunch } from "../pages/shared";
import { confirmedVoiceRoutesForCast, voiceRoutesForCast } from "../voiceRoutes";
import {
  acceptedVoiceSelections,
  automaticSharedVoiceSelections,
  chosenVoiceRevision,
  decisionsForCast,
  defaultNarratorDirection,
  identityDecisionSignature,
  resolvedLabelsForCast,
  routeForVoice,
  summarizedVoiceNames,
  voiceHasRevision,
} from "../workflow/cast";
import {
  message
} from "../workflow/presentation";

export type CastPageModel = Pick<WorkflowModel, "castingPreviewFingerprint" | "acceptCandidate" | "book" | "busy" | "castCandidate" | "castGenerationPaused" | "castingPreviewReady" | "castingSources" | "completed" | "confirmDefaultVoices" | "confirmedVoiceRoutes" | "designingVoices" | "editingCast" | "gateway" | "identityDecisions" | "language" | "narrationLanguageConfirmed" | "narratorDirection" | "processCandidate" | "regeneratingCharacterId" | "resolvedLabels" | "revisingStages" | "setCastCandidate" | "setCastGenerationPaused" | "setCastingSources" | "setConfirmDefaultVoices" | "setConfirmedVoiceRoutes" | "setDesigningVoices" | "setEditingCast" | "setError" | "setIdentityDecisions" | "setLanguage" | "setNarrationLanguageConfirmed" | "setNarratorDirection" | "setRegeneratingCharacterId" | "setResolvedLabels" | "setRevisingStages" | "setUploadingCharacterId" | "setVoiceModel" | "setVoiceRoutes" | "setVoiceSelections" | "snapshot" | "t" | "updateCastingPreview" | "uploadingCharacterId" | "voiceModel" | "voiceRoutes" | "voiceSelections">;

export function CastPage({ model }: { model: CastPageModel; }) {
  const { castingPreviewFingerprint, acceptCandidate, book, busy, castCandidate, castGenerationPaused, castingPreviewReady, castingSources, completed, confirmDefaultVoices, confirmedVoiceRoutes, designingVoices, editingCast, gateway, identityDecisions, language, narrationLanguageConfirmed, narratorDirection, processCandidate, regeneratingCharacterId, resolvedLabels, revisingStages, setCastCandidate, setCastGenerationPaused, setCastingSources, setConfirmDefaultVoices, setConfirmedVoiceRoutes, setDesigningVoices, setEditingCast, setError, setIdentityDecisions, setLanguage, setNarrationLanguageConfirmed, setNarratorDirection, setRegeneratingCharacterId, setResolvedLabels, setRevisingStages, setUploadingCharacterId, setVoiceModel, setVoiceRoutes, setVoiceSelections, snapshot, t, updateCastingPreview, uploadingCharacterId, voiceModel, voiceRoutes, voiceSelections } = model;
  const revising = revisingStages.includes("cast");
  const current = castCandidate ?? (revising ? undefined : snapshot?.cast);
  const hasPreviousCast = Boolean(snapshot?.cast)
    || (snapshot?.history.cast?.some((row) => row.status === "superseded") ?? false);
  const [confirmation, setConfirmation] = useState<
    | { kind: "replacement" }
    | { kind: "reclassify" }
  >();

  function beginCastReplacement() {
    setConfirmation({ kind: "replacement" });
  }

  function confirmCastReplacement() {
    const hasRestoredDraft = Boolean(current && current.revision !== snapshot?.cast?.revision);
    if (hasRestoredDraft) {
      setRevisingStages([...new Set([...revisingStages, "cast"])]);
      return;
    }
    // Accepted artifacts cannot be edited as candidates. Prepare the replacement
    // automatically, then take the user straight to its voices.
    void processCandidate("cast", {}).then((candidate) => {
      const cast = candidate as unknown as CastArtifact;
      setCastCandidate(cast);
      setIdentityDecisions(decisionsForCast(cast));
      setResolvedLabels(resolvedLabelsForCast(cast));
      setVoiceSelections({ ...automaticSharedVoiceSelections(cast), ...acceptedVoiceSelections(cast) });
      setVoiceRoutes(voiceRoutesForCast(cast));
      setConfirmedVoiceRoutes(confirmedVoiceRoutesForCast(cast));
      setVoiceModel(cast.voiceModel ?? voiceModel);
      setLanguage(cast.language ?? language);
      setNarratorDirection(cast.narrator?.voiceDirection ?? narratorDirection);
      setEditingCast(false);
      setDesigningVoices(false);
      setRevisingStages((stages) => [...new Set([...stages, "cast"])]);
    }).catch((reason) => setError(message(reason)));
  }

  function reclassifyCast() {
    setConfirmation({ kind: "reclassify" });
  }

  function confirmReclassifyCast() {
    void processCandidate("cast", { forceReclassify: true }).then((candidate) => {
      const cast = candidate as unknown as CastArtifact;
      setCastCandidate(cast);
      setIdentityDecisions(decisionsForCast(cast));
      setResolvedLabels(resolvedLabelsForCast(cast));
      setVoiceSelections({});
      setVoiceRoutes({});
      setConfirmedVoiceRoutes({});
      setNarratorDirection(defaultNarratorDirection);
      setEditingCast(false);
      setDesigningVoices(false);
    }).catch((reason) => setError(message(reason)));
  }

  function confirmRegenerate(characterId: string, voiceSettings: VoiceSettings) {
    if (!current) return;
    setRegeneratingCharacterId(characterId);
    void processCandidate("cast", { proposalRevision: current.revision, characterId, voiceSettings }).then((candidate) => {
      const cast = candidate as unknown as CastArtifact;
      const regenerated = [cast.narrator, ...(cast.identities ?? [])].find((row) => row?.characterId === characterId);
      setCastCandidate(cast);
      setVoiceSelections((selected) => {
        const next = { ...selected };
        if (regenerated && !voiceHasRevision(regenerated, selected[characterId])) delete next[characterId];
        return next;
      });
    }).catch((reason) => setError(message(reason))).finally(() => setRegeneratingCharacterId(undefined));
  }

  const confirmationDialog = confirmation && <div className="process-overlay">
    <DialogSurface as="div" className="process-modal cast-confirmation-modal" aria-labelledby="cast-confirmation-title" onDismiss={() => setConfirmation(undefined)}>
      <span className="eyebrow">{t("Cast decision")}</span>
      <h2 id="cast-confirmation-title">{t(confirmation.kind === "replacement" ? "Change the cast?" : "Reclassify source labels?")}</h2>
      <p>{t(confirmation.kind === "replacement"
        ? "Changing the cast or voices creates a replacement. After you accept it, the previous voices can no longer generate new audio. Existing generated audio and Library exports stay available. Continue?"
        : "Reclassify source labels from the accepted Dialogue? Current draft cast edits will be replaced. Once you accept the replacement, only its voices can generate new audio.")}</p>
      <div className="cast-default-actions">
        <button type="button" className="ghost" onClick={() => setConfirmation(undefined)}>{t("Keep current cast")}</button>
        <button type="button" className="primary" onClick={() => {
          setConfirmation(undefined);
          if (confirmation.kind === "replacement") confirmCastReplacement();
          else confirmReclassifyCast();
        }}>{t(confirmation.kind === "replacement" ? "Change cast" : "Reclassify labels")} →</button>
      </div>
    </DialogSurface>
  </div>;

  if (!current) return <><PageTitle stage="cast" step={t("Step 4 · Cast & voices")} title={t(hasPreviousCast ? "Review your cast." : "Build your cast.")} copy={t(hasPreviousCast ? "Confirm your existing cast against the updated review." : "Confirm which names belong to each character, then choose their voices.")} /><StageLaunch><button className="primary" onClick={() => void processCandidate("cast", {}, !hasPreviousCast).then((candidate) => {
    const cast = candidate as unknown as CastArtifact;
    setCastCandidate(cast);
    setIdentityDecisions(decisionsForCast(cast));
    setResolvedLabels(resolvedLabelsForCast(cast));
    setVoiceSelections({
      ...automaticSharedVoiceSelections(cast),
      ...acceptedVoiceSelections(cast),
    });
    setVoiceRoutes(voiceRoutesForCast(cast));
    setConfirmedVoiceRoutes(confirmedVoiceRoutesForCast(cast));
    setNarratorDirection(cast.narrator?.voiceDirection ?? defaultNarratorDirection);
    if (cast.phase === "identity-review") {
      const selection = draftVoiceSelection(snapshot?.voiceModels ?? [], [cast.voiceModel, voiceModel], [cast.language, cast.detectedLanguage, language]);
      setVoiceModel(selection.modelId);
      setLanguage(selection.language);
      setNarrationLanguageConfirmed(false);
    } else {
      if (cast.voiceModel) setVoiceModel(cast.voiceModel);
      if (cast.language) setLanguage(cast.language);
    }
  }).catch((reason) => setError(message(reason)))}>{t(hasPreviousCast ? "Review cast & voices" : "Find characters")} →</button></StageLaunch>{confirmationDialog}</>;
  if (completed.includes("cast") && !revising) { const voices = [current.narrator, ...(current.identities ?? [])].filter(Boolean); return <><AcceptedSummary stage="cast" step={t("Step 4")} title={t("Cast and voices ready")} revision={snapshot?.activeArtifacts.cast} onRevise={beginCastReplacement} note={t("Changing the cast or voices creates a replacement. Once accepted, only the replacement can generate new audio. Existing generated audio and Library exports stay available.")}><span><b>{voices.length}</b><small>{t("Assigned voices")}</small></span><span><b>{t(snapshot?.voiceSelection.language ?? "—")}</b><small>{t("Audition language")}</small></span><span><b>{snapshot?.voiceModels.find((row) => row.id === snapshot.voiceSelection.modelId)?.label ?? snapshot?.voiceSelection.modelId ?? "—"}</b><small>{t("Voice model")}</small></span></AcceptedSummary>{confirmationDialog}</>; }
  if (current.phase === "identity-review" || editingCast || current.auditionPackRefreshRequired) {
    const confirmationLabels = strongConfirmationLabelsForCast(current, identityDecisions);
    const pendingConfirmations = confirmationLabels.filter((label) => !resolvedLabels.includes(label));
    const enhancedCasting = snapshot?.castingPreviewAvailable === true && Boolean(gateway.previewCasting);
    const sourceBookIds = castingSources.bookId === book?.id ? castingSources.ids : [];
    const castEditsDirty = sourceBookIds.length > 0 || identityDecisionSignature(identityDecisions) !== identityDecisionSignature(decisionsForCast(current))
      || voiceModel !== (current.voiceModel ?? voiceModel)
      || language !== (current.language ?? language)
      || current.auditionPackRefreshRequired === true;
    const generateVoices = () => void processCandidate("cast", { proposalRevision: current.revision, identityDecisions: Object.values(identityDecisions), voiceModel, language, ...(enhancedCasting ? { sourceBookIds, castingPreviewFingerprint } : {}) }).then((candidate) => { const cast = candidate as unknown as CastArtifact; const castVoices = [cast.narrator, ...(cast.identities ?? [])].filter(Boolean) as CastVoice[]; setCastingSources({ bookId: book?.id ?? "", ids: [] }); setCastCandidate(cast); setVoiceSelections((selected) => ({ ...automaticSharedVoiceSelections(cast), ...acceptedVoiceSelections(cast), ...Object.fromEntries(castVoices.flatMap((voice) => voiceHasRevision(voice, selected[voice.characterId]) ? [[voice.characterId, selected[voice.characterId]]] : [])) })); setVoiceRoutes(voiceRoutesForCast(cast)); setConfirmedVoiceRoutes(confirmedVoiceRoutesForCast(cast)); setResolvedLabels(resolvedLabelsForCast(cast)); setNarratorDirection(cast.narrator?.voiceDirection ?? narratorDirection); setEditingCast(false); setDesigningVoices(false); }).catch((reason) => setError(message(reason)));
    const changeCastingModel = (id: string) => {
      setCastGenerationPaused(false);
      setVoiceModel(id);
      const supported = snapshot?.voiceModels.find((row) => row.id === id)?.supportedLanguages ?? [];
      if (!supported.includes(language)) {
        setLanguage(supported.includes("english") ? "english" : supported[0] ?? "");
        setNarrationLanguageConfirmed(false);
      }
    };
    if (enhancedCasting && designingVoices && book) {
      const languages = snapshot?.voiceModels.find((row) => row.id === voiceModel)?.supportedLanguages ?? [];
      return <section className="voice-design-screen" aria-label={t("Design the voices")}>
        <button className="ghost voice-design-back" onClick={() => { updateCastingPreview(false); setDesigningVoices(false); }}>← {t("Back to cast")}</button>
        <PageTitle stage="cast" step={t("Step 4 · Cast & voices")} title={t("Design the voices")} />
        <div className="voice-design-language">
          <div><label>{t("Narration language")}</label><p>{t("The language your audiobook will be spoken in.")}</p></div>
          <NarrationLanguagePicker languages={languages} language={narrationLanguageConfirmed ? language : ""} onChange={(id) => {
            // Confirming the default keeps its quote valid; only changed settings need a new one.
            if (id !== language) updateCastingPreview(false);
            setCastGenerationPaused(false);
            setLanguage(id);
            setNarrationLanguageConfirmed(Boolean(id));
          }} />
        </div>
        <CastingChoice models={snapshot?.voiceModels} gateway={gateway} bookId={book.id} settings={{ proposalRevision: current.revision, identityDecisions: Object.values(identityDecisions), voiceModel, language, sourceBookIds }} onReadyChange={updateCastingPreview} onSourcesChange={(ids) => { setCastGenerationPaused(false); setCastingSources({ bookId: book.id, ids }); }} onModelChange={changeCastingModel} action={<button className="primary" disabled={!castingPreviewReady || pendingConfirmations.length > 0 || !voiceModel || !language || !narrationLanguageConfirmed || (editingCast && !castEditsDirty)} onClick={generateVoices}>{t(castGenerationPaused ? "Continue voice generation" : current.auditionPackRefreshRequired ? "Regenerate audition pack" : editingCast ? "Apply cast edits" : "Continue")} →</button>} />
        {confirmationDialog}
      </section>;
    }
    return <><PageTitle stage="cast" step={t("Step 4 · Cast & voices")} title={t(editingCast ? "Review the cast." : "Build the cast.")} copy={t("Open a cast member to check its names and source labels.")} />
      <CastIdentityReview hideVoiceSettings={enhancedCasting} hideVoiceModel={enhancedCasting} cast={current} decisions={identityDecisions} setDecisions={setIdentityDecisions} resolvedLabels={resolvedLabels} setResolvedLabels={setResolvedLabels} voiceModels={snapshot?.voiceModels ?? []} voiceModel={voiceModel} language={language} onVoiceModelChange={(id) => { setCastGenerationPaused(false); setVoiceModel(id); const supported = snapshot?.voiceModels.find((row) => row.id === id)?.supportedLanguages ?? []; if (!supported.includes(language)) setLanguage(supported.includes("english") ? "english" : supported[0] ?? ""); }} onLanguageChange={(id) => { setCastGenerationPaused(false); setLanguage(id); }} onReclassify={editingCast ? reclassifyCast : undefined} />
      <div className="phase-action cast-final-action"><span>{pendingConfirmations.length ? t(pendingConfirmations.length === 1 ? "1 cast label still needs confirmation" : "{{count}} cast labels still need confirmation", { count: pendingConfirmations.length }) : t(castGenerationPaused ? "Completed voices are saved; continue from the interrupted voice" : current.auditionPackRefreshRequired ? "The voice recipe changed; regenerate the complete audition pack" : editingCast ? castEditsDirty ? "Unchanged auditions will be kept" : "No cast changes to apply" : "Cast structure is ready for auditions")}</span><div className="phase-action-buttons" role="group" aria-label={t("Cast edit actions")}>{editingCast && <button className="ghost" onClick={() => { setIdentityDecisions(decisionsForCast(current)); setResolvedLabels(resolvedLabelsForCast(current)); setVoiceModel(current.voiceModel ?? voiceModel); setLanguage(current.language ?? language); setNarratorDirection(current.narrator?.voiceDirection ?? narratorDirection); setCastingSources({ bookId: book?.id ?? "", ids: [] }); updateCastingPreview(false); setDesigningVoices(false); setEditingCast(false); }}>{t("Cancel cast edits")}</button>}<button className="primary" disabled={pendingConfirmations.length > 0 || (!enhancedCasting && (!voiceModel || !language || (editingCast && !castEditsDirty)))} onClick={enhancedCasting ? () => { updateCastingPreview(false); setDesigningVoices(true); } : generateVoices}>{t(pendingConfirmations.length ? "Confirm cast identities" : enhancedCasting ? "Design the voices" : castGenerationPaused ? "Continue voice generation" : current.auditionPackRefreshRequired ? "Regenerate audition pack" : editingCast ? "Apply cast edits" : enhancedCasting ? "Continue" : "Generate required auditions")} →</button></div></div>{confirmationDialog}</>;
  }
  const voices = [current.narrator, ...(current.identities ?? [])].filter(Boolean) as CastVoice[];
  const voiceById = Object.fromEntries(voices.map((voice) => [voice.characterId, voice]));
  const layeredRouteReady = (voice: CastVoice) => {
    const route = routeForVoice(voice, voiceRoutes);
    return route.kind === "layered"
      && confirmedVoiceRoutes[voice.characterId] === true
      && route.characterIds.length >= 2
      && new Set(route.characterIds).size === route.characterIds.length
      && route.characterIds.every((id) => {
        const member = voiceById[id];
        return member?.category === "character" && Boolean(chosenVoiceRevision(member, voiceSelections));
      });
  };
  const unapprovedVoices = voices.filter((voice) => {
    const route = routeForVoice(voice, voiceRoutes);
    return route.kind === "layered"
      ? !layeredRouteReady(voice)
      : !voiceHasRevision(voice, voiceSelections[voice.characterId]);
  });
  const unavailableVoices = voices.filter((voice) => {
    const route = routeForVoice(voice, voiceRoutes);
    return route.kind === "layered"
      ? !layeredRouteReady(voice)
      : !chosenVoiceRevision(voice, voiceSelections);
  });
  const approvedCount = voices.length - unapprovedVoices.length;

  function submitCastVoices() {
    if (unavailableVoices.length) {
      setError("Every cast identity needs an available audition or a complete layered voice route before Cast & voices can be accepted.");
      return;
    }
    const decisions = voices.map((voice) => {
      const voiceRoute = routeForVoice(voice, voiceRoutes);
      return voiceRoute.kind === "layered"
        ? { characterId: voice.characterId, voiceRoute }
        : { characterId: voice.characterId, voiceRevision: chosenVoiceRevision(voice, voiceSelections)! };
    });
    setConfirmDefaultVoices(false);
    setVoiceSelections(Object.fromEntries(decisions.flatMap((decision) =>
      "voiceRevision" in decision && decision.voiceRevision
        ? [[decision.characterId, decision.voiceRevision]]
        : [],
    )));
    void acceptCandidate("cast", current, decisions);
  }

  function requestCastAcceptance() {
    if (unapprovedVoices.length) {
      setConfirmDefaultVoices(true);
      return;
    }
    submitCastVoices();
  }

  return <>
    <header className="voice-stage-heading"><h1>{t("Voices")}</h1><PhaseHelp stage="cast" /></header>
    <CastVoiceReview
      layeredVoicePreviewUrl={gateway.layeredVoicePreviewUrl?.bind(gateway)}
      bookId={book?.id ?? ""}
      cast={current}
      selections={voiceSelections}
      routes={voiceRoutes}
      confirmedRoutes={confirmedVoiceRoutes}
      onRouteChange={(characterId, route) => {
        setVoiceRoutes((currentRoutes) => ({ ...currentRoutes, [characterId]: route }));
        setConfirmedVoiceRoutes((confirmed) => ({ ...confirmed, [characterId]: false }));
      }}
      onConfirmRoute={(characterId) => setConfirmedVoiceRoutes((confirmed) => ({ ...confirmed, [characterId]: true }))}
      onApprove={(characterId, revision) => setVoiceSelections((selected) => ({ ...selected, [characterId]: revision }))}
      regeneratingCharacterId={regeneratingCharacterId}
      uploadingCharacterId={uploadingCharacterId}
      onTranscribe={(file) => {
        if (!book) return Promise.reject(new Error("Book not found"));
        return gateway.transcribeVoiceSample(book.id, file);
      }}
      onUpload={(characterId, file, referenceText) => {
        if (!book) return;
        setUploadingCharacterId(characterId);
        setError(undefined);
        void gateway.uploadVoiceSample(book.id, current.revision, characterId, file, referenceText).then((cast) => {
          setCastCandidate(cast);
        }).catch((reason) => setError(message(reason))).finally(() => setUploadingCharacterId(undefined));
      }}
      loadSourceVoices={snapshot?.castingPreviewAvailable && gateway.previewCasting && book ? () => gateway.previewCasting!(book.id, { proposalRevision: current.revision, identityDecisions: current.identityDecisions, voiceModel: current.voiceModel ?? voiceModel, language: current.language ?? language, sourceBookIds: [] }) : undefined}
      onReuseVoice={(characterId, sourceVoice) => {
        setRegeneratingCharacterId(characterId);
        void processCandidate("cast", { proposalRevision: current.revision, characterId, sourceVoice }).then((candidate) => {
          const cast = candidate as unknown as CastArtifact;
          setCastCandidate(cast);
          setVoiceSelections((selected) => { const next = { ...selected }; delete next[characterId]; return next; });
        }).catch((reason) => setError(message(reason))).finally(() => setRegeneratingCharacterId(undefined));
      }}
      onRegenerate={confirmRegenerate}
    />
    <div className="phase-action cast-voice-final-action">
      <span>{unavailableVoices.length > 0
        ? unavailableVoices.length === 1 ? t("1 voice still requires review") : t("{{count}} voices still require review", { count: unavailableVoices.length })
        : unapprovedVoices.length > 0
          ? t("{{approved}} approved individually · {{remaining}} ready for approval", { approved: approvedCount, remaining: unapprovedVoices.length })
          : t("All {{count}} voices approved", { count: voices.length })}</span>
      <div className="phase-action-buttons" role="group" aria-label={t("Cast voice actions")}>
        <button className="ghost" onClick={() => { setDesigningVoices(false); setEditingCast(true); }}>← {t(current.reusedFromRevision ? "Review cast" : "Edit cast")}</button>
        <button className="primary" disabled={busy || unavailableVoices.length > 0} onClick={requestCastAcceptance}>{t("Accept cast & voices")} →</button>
      </div>
    </div>
    {confirmDefaultVoices && <div className="process-overlay">
      <DialogSurface as="div" className="process-modal cast-default-modal" aria-labelledby="default-voices-title" onDismiss={() => setConfirmDefaultVoices(false)}>
        <span className="eyebrow">{t("Approval confirmation")}</span>
        <h2 id="default-voices-title">{unapprovedVoices.length === 1 ? t("Approve 1 remaining voice?") : t("Approve {{count}} remaining voices?", { count: unapprovedVoices.length })}</h2>
        <p>{unapprovedVoices.length === 1
          ? t("Continuing approves the latest audition for {{name}} and accepts the full cast.", { name: summarizedVoiceNames(unapprovedVoices) })
          : t("Continuing approves the latest audition for each of these voices and accepts the full cast: {{names}}.", { names: summarizedVoiceNames(unapprovedVoices) })}</p>
        {approvedCount > 0 && <p>{approvedCount === 1 ? t("Your 1 approved choice stays exactly as selected.") : t("Your {{count}} approved choices stay exactly as selected.", { count: approvedCount })}</p>}
        <div className="cast-default-actions">
          <button className="ghost" onClick={() => setConfirmDefaultVoices(false)}>{t("Keep reviewing")}</button>
          <button className="primary" onClick={submitCastVoices}>{t("Approve remaining & accept")} →</button>
        </div>
      </DialogSurface>
    </div>}
    {confirmationDialog}
  </>;

}
