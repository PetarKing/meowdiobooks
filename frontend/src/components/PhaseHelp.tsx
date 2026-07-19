import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { WizardStage } from "../api/contracts";

type HelpMove = {
  cue: string;
  cueSub?: string;
  title: string;
  detail: string;
};

type PhaseGuide = {
  number: string;
  label: string;
  title: string;
  intro: string;
  route: string[];
  moves: HelpMove[];
};

type GuideStage = Exclude<WizardStage, "import"> | "export";

const guides: Record<GuideStage, PhaseGuide> = {
  extract: {
    number: "01", label: "Extract", title: "Choose the reader, not the prettiest preview.",
    intro: "The parser's job is to recover clean reading order. Compare the original page with the text beside it and look for sequence mistakes. A new extraction replaces the accepted source only after the complete book succeeds.",
    route: ["Start with LiteParse", "Check the representative pages", "Switch only when reading order breaks"],
    moves: [
      { cue: "A→B", title: "Follow the reading order", detail: "Columns, captions, headings, and footnotes should arrive in the order a narrator would read them." },
      { cue: "≠", title: "Ignore cosmetic differences", detail: "Line wrapping does not matter. Missing, duplicated, or scrambled text does." },
      { cue: "▦", title: "Use layout-aware sparingly", detail: "It is the slower fallback for pages whose structure defeats the simpler parsers." },
    ],
  },
  dialogue: {
    number: "02", label: "Dialogue", title: "Let certainty lead; use AI for the gaps.",
    intro: "Clear speaker labels stay fixed. You choose whether uncertain dialogue gets a bounded AI guess or the narrator. After AI runs, filter its choices and correct only the misses.",
    route: ["Check detected formats", "Choose AI scope—or narrator", "Filter results; correct only misses"],
    moves: [
      { cue: "“…”", title: "Explicit speakers stay locked", detail: "AI does not reinterpret dialogue that already has a clear speaker label." },
      { cue: "?→AI", title: "Scope the uncertain parts", detail: "Only the selected unresolved groups are sent for speaker attribution." },
      { cue: "✎", title: "Correct only what is wrong", detail: "Choose a character or Narrator. Internal transcript segmentation stays out of the decision." },
    ],
  },
  review: {
    number: "03", label: "Review", title: "Decide once, with the evidence in view.",
    intro: "Review groups similar issues so you can make consistent decisions without inspecting the whole manuscript line by line. Use the recommendation when examples agree; inspect the exceptions when they do not.",
    route: ["Approve real chapter starts", "Inspect a representative occurrence", "Apply one decision to its warning group"],
    moves: [
      { cue: "▰", title: "Only the highlight changes", detail: "The surrounding text is context. It remains untouched." },
      { cue: "1×N", title: "Choices apply as a group", detail: "A resolution affects the matching flagged spans shown by that warning." },
      { cue: "✓", title: "Nothing changes early", detail: "Your accepted version stays active until every required decision is complete." },
    ],
  },
  cast: {
    number: "04", label: "Cast & voices", title: "Shape the cast with your hands—and your ears.",
    intro: "First decide who is who. Click a cast card to inspect its evidence, then audition each resulting role. Approving a voice keeps that exact audition—not merely the newest one.",
    route: ["Resolve uncertain identities", "Generate and compare auditions", "Approve a voice or group route"],
    moves: [
      { cue: "A → B", title: "Drag people together", detail: "Drop one cast member onto another to merge their source labels into one identity." },
      { cue: "A → N", title: "Route a role to Narrator", detail: "Drop a cast member onto Narrator when those dialogue lines should use the narrator voice." },
      { cue: "▶︎ A+B", title: "Approve voices or routes", detail: "Keep useful audition history; a group may instead reuse confirmed character voices together." },
    ],
  },
  enrich: {
    number: "05", label: "Enrich", title: "A deliberate pause, for now.",
    intro: "This is the future home for performance enrichment. Today it is an honest pass-through: continuing changes nothing.",
    route: ["Review the production recap", "See what is planned", "Continue with the original approved performance"],
    moves: [
      { cue: "0", title: "Zero book changes", detail: "No text, speaker, identity, voice, or audio is modified in this phase." },
      { cue: "✓", title: "Your decisions carry forward", detail: "The accepted transcript and cast remain the authority downstream." },
      { cue: "→", title: "Safe to continue", detail: "Generate will prepare the final recording script from everything you approved." },
    ],
  },
  generate: {
    number: "06", label: "Generate", title: "Render only what you are ready to hear.",
    intro: "The first visit prepares one final script from your approved text, speakers, and voices. Then choose chapters, create their audio, and listen before moving on. If an approved input would change a chapter, its earlier audio becomes stale.",
    route: ["Select the chapters you want", "Generate chapter audio", "Listen; regenerate anything marked Stale"],
    moves: [
      { cue: "☑", title: "Generate selectively", detail: "You do not need to render the entire book to test the production." },
      { cue: "🔒", title: "Uses approved choices", detail: "Audio uses the cached recording script built from your transcript, cast, and voices." },
      { cue: "↻", title: "Stale audio stays playable", detail: "Listen for comparison, then regenerate it before export so the chapter matches your current choices." },
    ],
  },
  export: {
    number: "07", label: "Export", title: "Bundle the chapters you want to share.",
    intro: "Export takes current chapter WAVs and packages the selected set as a high-quality M4B, a smaller M4B, or ordered MP3 chapters. You can override the title, author, and cover without changing the PDF or generated audio.",
    route: ["Choose finished chapters", "Confirm the book details", "Choose a format and create it in your Library"],
    moves: [
      { cue: "☑", title: "Your chapter set", detail: "A partial export is fine. Only the selected current WAVs are included, in book order." },
      { cue: "Aa", title: "Export-only metadata", detail: "Title, author, and cover edits apply only to this export, not the source book." },
      { cue: "M4B", title: "Audiobook-ready choices", detail: "Both M4Bs preserve chapter navigation; MP3 export provides one widely compatible file per chapter in a ZIP." },
    ],
  },
};

export function PhaseHelp({ stage }: { stage: GuideStage }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const guide = guides[stage];

  const cueClassName = (move: HelpMove) => [
    "phase-help-cue",
    move.cueSub ? "has-subcue" : "",
    [...move.cue].length > 3 ? "is-compact" : "",
  ].filter(Boolean).join(" ");

  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  const dialog = open ? createPortal(<div className="phase-help-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`phase-help phase-help-${stage}`}>
      <header className="phase-help-head">
        <div className="phase-help-number" aria-hidden="true">{guide.number}</div>
        <div><span className="eyebrow">{t("A quick guide to {{phase}}", { phase: t(guide.label) })}</span><h2 id={titleId}>{t(guide.title)}</h2></div>
        <button ref={closeRef} type="button" className="phase-help-close" aria-label={t("Close phase guide")} onClick={close}>×</button>
      </header>

      <div className="phase-help-body">
        <section className="phase-help-reading" aria-labelledby={`${titleId}-overview`}>
          <span className="eyebrow">{t("What this phase does")}</span>
          <h3 id={`${titleId}-overview`}>{t("The useful version")}</h3>
          <p>{t(guide.intro)}</p>
          <div className="phase-help-path">
            <strong>{t("Best way through")}</strong>
            <ol>{guide.route.map((step) => <li key={step}>{t(step)}</li>)}</ol>
          </div>
        </section>
        <section className="phase-help-moves" aria-label={t("Worth knowing")}>
          <span className="eyebrow">{t("Worth knowing")}</span>
          <ul>{guide.moves.map((move) => <li key={move.title}><span className={cueClassName(move)} aria-hidden="true">{move.cueSub ? <><b>{move.cue}</b><small>{move.cueSub}</small></> : move.cue}</span><p><strong>{t(move.title)}.</strong> {t(move.detail)}</p></li>)}</ul>
        </section>
      </div>
    </section>
  </div>, document.body) : null;

  return <>
    <button ref={triggerRef} type="button" className="phase-help-trigger" aria-label={t("About {{phase}}", { phase: t(guide.label) })} aria-haspopup="dialog" onClick={() => setOpen(true)}>(?)</button>
    {dialog}
  </>;
}
