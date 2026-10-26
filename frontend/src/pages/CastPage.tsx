import { DialogBackdrop } from "../components/DialogBackdrop";
import { useEffect, useState } from "react";
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
import { VoiceLanguagePicker } from "../components/VoiceLanguagePicker";
import { draftVoiceSelection, rankedVoiceLanguages } from "../workflow/voiceSelection";
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

export type CastPageModel = Pick<WorkflowModel, "capabilities" | "castingPreviewFingerprint" | "acceptCandidate" | "book" | "busy" | "castCandidate" | "castGenerationPaused" | "castingPreviewReady" | "completed" | "confirmDefaultVoices" | "confirmedVoiceRoutes" | "designingVoices" | "editingCast" | "gateway" | "identityDecisions" | "language" | "narrationLanguageConfirmed" | "narratorDirection" | "processCandidate" | "regeneratingCharacterId" | "resolvedLabels" | "revisingStages" | "setCastCandidate" | "setCastGenerationPaused" | "setConfirmDefaultVoices" | "setConfirmedVoiceRoutes" | "setDesigningVoices" | "setEditingCast" | "setError" | "setIdentityDecisions" | "setLanguage" | "setNarrationLanguageConfirmed" | "setNarratorDirection" | "setRegeneratingCharacterId" | "setResolvedLabels" | "setRevisingStages" | "setUploadingCharacterId" | "setVoiceModel" | "setVoiceRoutes" | "setVoiceSelections" | "snapshot" | "t" | "updateCastingPreview" | "uploadingCharacterId" | "voiceModel" | "voiceRoutes" | "voiceSelections">;

export function CastPage({ model }: { model: CastPageModel; }) {
  const { capabilities, castingPreviewFingerprint, acceptCandidate, book, busy, castCandidate, castGenerationPaused, castingPreviewReady, completed, confirmDefaultVoices, confirmedVoiceRoutes, designingVoices, editingCast, gateway, identityDecisions, language, narrationLanguageConfirmed, narratorDirection, processCandidate, regeneratingCharacterId, resolvedLabels, revisingStages, setCastCandidate, setCastGenerationPaused, setConfirmDefaultVoices, setConfirmedVoiceRoutes, setDesigningVoices, setEditingCast, setError, setIdentityDecisions, setLanguage, setNarrationLanguageConfirmed, setNarratorDirection, setRegeneratingCharacterId, setResolvedLabels, setRevisingStages, setUploadingCharacterId, setVoiceModel, setVoiceRoutes, setVoiceSelections, snapshot, t, updateCastingPreview, uploadingCharacterId, voiceModel, voiceRoutes, voiceSelections } = model;
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const revising = revisingStages.includes("cast");
  const current = castCandidate ?? (revising ? undefined : snapshot?.cast);
  const [priorMatches, setPriorMatches] = useState<{
    key: string; matches: CastArtifact["previousVoiceMatches"];
  }>();
  const reuseKey = snapshot?.voiceReuseAvailable && book && current
    && (current.phase === "identity-review" || editingCast)
    ? JSON.stringify({ bookId: book.id, settings: { proposalRevision: current.revision,
        identityDecisions: Object.values(identityDecisions), voiceModel, language, sourceBookIds: [] } })
    : "";
  useEffect(() => {
    if (!reuseKey || !gateway.previewCasting) return;
    let disposed = false;
    const request = JSON.parse(reuseKey);
    const timer = window.setTimeout(() => {
      gateway.previewCasting!(request.bookId, request.settings).then((preview) => {
        if (!disposed) setPriorMatches({ key: reuseKey, matches: preview.previousVoiceMatches ?? {} });
      }).catch(() => {
        if (!disposed) setPriorMatches({ key: reuseKey, matches: {} });
      });
    }, 150);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [reuseKey, gateway]);
  const castWithMatches = current && reuseKey
    ? { ...current, previousVoiceMatches: priorMatches?.key === reuseKey ? priorMatches.matches : {} }
    : current;
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

  const confirmationDialog = confirmation && <DialogBackdrop className="process-overlay">
    <DialogSurface as="div" className="process-modal cast-confirmation-modal" aria-labelledby="cast-confirmation-title" onDismiss={() => setConfirmation(undefined)}>
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
  </DialogBackdrop>;

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
      setNarrationLanguageConfirmed(Boolean(selection.language && (cast.language === selection.language || cast.detectedLanguage === selection.language)));
    } else {
      if (cast.voiceModel) setVoiceModel(cast.voiceModel);
      if (cast.language) setLanguage(cast.language);
    }
  }).catch((reason) => setError(message(reason)))}>{t(hasPreviousCast ? "Review cast & voices" : "Find characters")} →</button></StageLaunch>{confirmationDialog}</>;
  if (completed.includes("cast") && !revising) { const voices = [current.narrator, ...(current.identities ?? [])].filter(Boolean); return <><AcceptedSummary stage="cast" step={t("Step 4")} title={t("Cast and voices ready")} revision={snapshot?.activeArtifacts.cast} onRevise={beginCastReplacement} note={t("Changing the cast or voices creates a replacement. Once accepted, only the replacement can generate new audio. Existing generated audio and Library exports stay available.")}><span><b>{voices.length}</b><small>{t("Assigned voices")}</small></span><span><b>{t(snapshot?.voiceSelection.language ?? "—")}</b><small>{t("Audition language")}</small></span>{capabilities.showVoiceModelControls && <span><b>{snapshot?.voiceModels.find((row) => row.id === snapshot.voiceSelection.modelId)?.label ?? "—"}</b><small>{t("Voice model")}</small></span>}</AcceptedSummary>{confirmationDialog}</>; }
  if (current.phase === "identity-review" || editingCast || current.auditionPackRefreshRequired) {
    const confirmationLabels = strongConfirmationLabelsForCast(current, identityDecisions);
    const pendingConfirmations = confirmationLabels.filter((label) => !resolvedLabels.includes(label));
    const enhancedCasting = snapshot?.castingPreviewAvailable === true && Boolean(gateway.previewCasting);
    const sourceBookIds: string[] = [];
    const castEditsDirty = identityDecisionSignature(identityDecisions) !== identityDecisionSignature(decisionsForCast(current))
      || voiceModel !== (current.voiceModel ?? snapshot?.voiceSelection.modelId ?? voiceModel)
      || language !== (current.language ?? snapshot?.voiceSelection.language ?? language)
      || current.auditionPackRefreshRequired === true;
    const keepExistingVoices = editingCast && !castEditsDirty && current.phase !== "identity-review" && !castGenerationPaused;
    const generateVoices = () => { setLanguagePickerOpen(false); setDesigningVoices(false); void processCandidate("cast", { proposalRevision: current.revision, identityDecisions: Object.values(identityDecisions), voiceModel, language, ...(enhancedCasting ? { sourceBookIds, castingPreviewFingerprint } : {}) }).then((candidate) => { const cast = candidate as unknown as CastArtifact; const castVoices = [cast.narrator, ...(cast.identities ?? [])].filter(Boolean) as CastVoice[]; setCastCandidate(cast); setVoiceSelections((selected) => ({ ...automaticSharedVoiceSelections(cast), ...acceptedVoiceSelections(cast), ...Object.fromEntries(castVoices.flatMap((voice) => voiceHasRevision(voice, selected[voice.characterId]) ? [[voice.characterId, selected[voice.characterId]]] : [])) })); setVoiceRoutes(voiceRoutesForCast(cast)); setConfirmedVoiceRoutes(confirmedVoiceRoutesForCast(cast)); setResolvedLabels(resolvedLabelsForCast(cast)); setNarratorDirection(cast.narrator?.voiceDirection ?? narratorDirection); setEditingCast(false); setDesigningVoices(false); }).catch((reason) => { setLanguagePickerOpen(false); setDesigningVoices(false); updateCastingPreview(false); setError(message(reason)); }); };
    const changeCastingModel = (id: string) => {
      setCastGenerationPaused(false);
      setVoiceModel(id);
      const supported = snapshot?.voiceModels.find((row) => row.id === id)?.supportedLanguages ?? [];
      if (!supported.includes(language)) {
        setLanguage(supported.includes("english") ? "english" : supported[0] ?? "");
        setNarrationLanguageConfirmed(false);
      }
    };
    const voiceOptionsUnavailable = !snapshot?.voiceModels.some((row) => row.id === voiceModel && row.supportedLanguages.length > 0);
    const availableVoiceModels = snapshot?.voiceModels.filter((row) => row.supportedLanguages.length > 0) ?? [];
    const replacementVoiceModel = availableVoiceModels.find((row) => row.id === snapshot?.voiceSelection.modelId)
      ?? availableVoiceModels[0];
    const refreshVoiceOptions = voiceOptionsUnavailable && <div className="voice-options-recovery">
      <p>{t("Your previous voice setup is no longer available. Refresh the options to continue.")}</p>
      <button type="button" className="ghost" disabled={!replacementVoiceModel || busy} onClick={() => {
        if (!replacementVoiceModel) return;
        updateCastingPreview(false);
        changeCastingModel(replacementVoiceModel.id);
        setNarrationLanguageConfirmed(false);
      }}>{t("Refresh voice options")}</button>
    </div>;
    // Confirmation is shared UI; only quote/reuse checks depend on the optional adapter.
    const languages = rankedVoiceLanguages(snapshot?.voiceModels.find((row) => row.id === voiceModel)?.supportedLanguages ?? [], current.languageProbabilities, current.detectedLanguage);
    const showMethodRows = capabilities.showVoiceModelControls && availableVoiceModels.length > 1;
    const closeVoiceSetup = () => { setLanguagePickerOpen(false); updateCastingPreview(false); setDesigningVoices(false); };
    const generateAction = <button type="button" className="primary" disabled={busy || pendingConfirmations.length > 0 || (!keepExistingVoices && (voiceOptionsUnavailable || (enhancedCasting && !castingPreviewReady) || !voiceModel || !languages.includes(language) || !narrationLanguageConfirmed))} onClick={keepExistingVoices ? () => { closeVoiceSetup(); setEditingCast(false); } : generateVoices}>{t(keepExistingVoices ? "Continue" : castGenerationPaused ? "Continue voice generation" : "Generate voices")} →</button>;
    const voiceSetupDialog = designingVoices && <DialogBackdrop className="process-overlay voice-setup-overlay">
      <DialogSurface className="voice-setup-modal" aria-labelledby="voice-setup-title" onDismiss={busy ? undefined : languagePickerOpen ? () => setLanguagePickerOpen(false) : closeVoiceSetup}>
        <header className="voice-setup-heading">
          <span className="voice-setup-eyebrow">{t("Cast & voices")}</span>
          <button type="button" className="ghost" aria-label={t("Cancel voice setup")} disabled={busy} onClick={closeVoiceSetup}>×</button>
          <h2 id="voice-setup-title">{t("Ready for their voices?")}</h2>
        </header>
        <div className="voice-setup-content">
          {refreshVoiceOptions}
          <section className="voice-setup-language" aria-labelledby="voice-setup-language-title">
            <h3 id="voice-setup-language-title">{t("Narration language")}</h3>
            <VoiceLanguagePicker expanded={languagePickerOpen} onExpandedChange={setLanguagePickerOpen} languages={languages} language={narrationLanguageConfirmed ? language : ""} onChange={(id) => {
              if (id !== language) updateCastingPreview(false);
              setCastGenerationPaused(false);
              setLanguage(id);
              setNarrationLanguageConfirmed(Boolean(id));
            }} />
          </section>
          <section hidden={!showMethodRows && !enhancedCasting} className="voice-setup-method" aria-labelledby={showMethodRows ? "voice-setup-method-title" : undefined}>
            {showMethodRows && <h3 id="voice-setup-method-title">{t("Generation method")}</h3>}
            {enhancedCasting && book ? <CastingChoice showVoiceModelControls={capabilities.showVoiceModelControls && showMethodRows} models={snapshot?.voiceModels} gateway={gateway} bookId={book.id} settings={{ proposalRevision: current.revision, identityDecisions: Object.values(identityDecisions), voiceModel, language, sourceBookIds }} onReadyChange={updateCastingPreview} onModelChange={changeCastingModel} />
              : showMethodRows && capabilities.showVoiceModelControls && <div className="voice-setup-models">{availableVoiceModels.map((option) => <button type="button" className={`voice-setup-model${voiceModel === option.id ? " selected" : ""}`} key={option.id} aria-pressed={voiceModel === option.id} onClick={() => changeCastingModel(option.id)}><span>{option.label}</span><span className="voice-setup-check" aria-hidden="true">{voiceModel === option.id ? "✓" : ""}</span></button>)}</div>}
          </section>
        </div>
        <footer className="voice-setup-footer"><div><button type="button" className="ghost" disabled={busy} onClick={closeVoiceSetup}>← {t("Back to cast")}</button>{generateAction}</div></footer>
      </DialogSurface>
    </DialogBackdrop>;
    return <><PageTitle stage="cast" step={t("Step 4 · Cast & voices")} title={t(editingCast ? "Review the cast." : "Build the cast.")} copy={t("Open a cast member to check its names and source labels.")} />
      <CastIdentityReview hideVoiceSettings={true} hideVoiceModel={enhancedCasting || !capabilities.showVoiceModelControls} cast={castWithMatches!} decisions={identityDecisions} setDecisions={setIdentityDecisions} resolvedLabels={resolvedLabels} setResolvedLabels={setResolvedLabels} voiceModels={snapshot?.voiceModels ?? []} voiceModel={voiceModel} language={language} onVoiceModelChange={(id) => { setCastGenerationPaused(false); setVoiceModel(id); const supported = snapshot?.voiceModels.find((row) => row.id === id)?.supportedLanguages ?? []; if (!supported.includes(language)) setLanguage(supported.includes("english") ? "english" : supported[0] ?? ""); }} onLanguageChange={(id) => { setCastGenerationPaused(false); setLanguage(id); }} onReclassify={editingCast ? reclassifyCast : undefined} />

      <div className="phase-action cast-final-action"><span>{pendingConfirmations.length ? t(pendingConfirmations.length === 1 ? "1 cast label still needs confirmation" : "{{count}} cast labels still need confirmation", { count: pendingConfirmations.length }) : t(castGenerationPaused ? "Completed voices are saved; continue from the interrupted voice" : current.auditionPackRefreshRequired ? "Your voices need refreshing before you continue." : editingCast ? castEditsDirty ? "Unchanged auditions will be kept" : "No cast changes to apply" : "")}</span><div className="phase-action-buttons" role="group" aria-label={t("Cast edit actions")}>{editingCast && <button className="ghost" onClick={() => { setIdentityDecisions(decisionsForCast(current)); setResolvedLabels(resolvedLabelsForCast(current)); setVoiceModel(current.voiceModel ?? voiceModel); setLanguage(current.language ?? language); setNarratorDirection(current.narrator?.voiceDirection ?? narratorDirection); updateCastingPreview(false); setDesigningVoices(false); setEditingCast(false); }}>{t("Cancel cast edits")}</button>}<button className="primary" disabled={busy || pendingConfirmations.length > 0} onClick={() => { updateCastingPreview(false); setDesigningVoices(true); }}>{t(pendingConfirmations.length ? "Confirm cast identities" : "Next")} →</button></div></div>{voiceSetupDialog}{confirmationDialog}</>;
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
    {confirmDefaultVoices && <DialogBackdrop className="process-overlay">
      <DialogSurface as="div" className="process-modal cast-default-modal" aria-labelledby="default-voices-title" onDismiss={() => setConfirmDefaultVoices(false)}>
        <h2 id="default-voices-title">{unapprovedVoices.length === 1 ? t("Approve 1 remaining voice?") : t("Approve {{count}} remaining voices?", { count: unapprovedVoices.length })}</h2>
        <p>{unapprovedVoices.length === 1
          ? t("Continuing approves the default audition for {{name}} and accepts the full cast.", { name: summarizedVoiceNames(unapprovedVoices) })
          : t("Continuing approves the default audition for each of these voices and accepts the full cast: {{names}}.", { names: summarizedVoiceNames(unapprovedVoices) })}</p>
        {approvedCount > 0 && <p>{approvedCount === 1 ? t("Your 1 approved choice stays exactly as selected.") : t("Your {{count}} approved choices stay exactly as selected.", { count: approvedCount })}</p>}
        <div className="cast-default-actions">
          <button className="ghost" onClick={() => setConfirmDefaultVoices(false)}>{t("Keep reviewing")}</button>
          <button className="primary" onClick={submitCastVoices}>{t("Approve remaining & accept")} →</button>
        </div>
      </DialogSurface>
    </DialogBackdrop>}
    {confirmationDialog}
  </>;

}
