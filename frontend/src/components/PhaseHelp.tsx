import { useId, useRef, useState } from "react";
import { DialogSurface } from "./DialogSurface";
import { DialogBackdrop } from "./DialogBackdrop";
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
    number: "01", label: "Extract", title: "Check the reading order.",
    intro: "Compare the source with the extracted text. Check for missing or out-of-order passages. Your accepted text is replaced only when the full extraction succeeds.",
    route: ["Start with the standard method", "Compare the sample pages", "Try another reading method if needed"],
    moves: [
      { cue: "A→B", title: "Follow the reading order", detail: "Columns, captions, headings, and footnotes should follow the reading order." },
      { cue: "≠", title: "Ignore cosmetic differences", detail: "Line wrapping does not matter. Missing, duplicated, or scrambled text does." },
      { cue: "▦", title: "Try the complex layout option", detail: "Use it if the other methods put text in the wrong order. It takes longer." },
    ],
  },
  dialogue: {
    number: "02", label: "Dialogue", title: "Choose who reads each line.",
    intro: "Keep known speakers. Let AI suggest speakers for uncertain dialogue, or use Narrator. Review and correct the results before accepting.",
    route: ["Check detected formats", "Choose AI suggestions or Narrator", "Review the results"],
    moves: [
      { cue: "“…”", title: "Explicit speakers stay locked", detail: "AI does not reinterpret dialogue that already has a clear speaker label." },
      { cue: "?→AI", title: "Choose what AI checks", detail: "AI checks only the uncertain dialogue you select." },
      { cue: "✎", title: "Correct only what is wrong", detail: "Assign a character or Narrator to any line that needs correcting." },
    ],
  },
  review: {
    number: "03", label: "Review", title: "Review the text before recording.",
    intro: "Check highlighted text and chapter starts. Choose what listeners should hear, and review suggested corrections before applying them.",
    route: ["Approve real chapter starts", "Check the highlighted examples", "Choose an action for each group"],
    moves: [
      { cue: "▰", title: "Only the highlight changes", detail: "The surrounding text is context. It remains untouched." },
      { cue: "1×N", title: "Check what each choice affects", detail: "Some choices apply to a whole group. Suggested corrections are reviewed individually, or you can apply all remaining suggestions together." },
      { cue: "✓", title: "Nothing changes early", detail: "Changes take effect when you complete and accept the review." },
    ],
  },
  cast: {
    number: "04", label: "Cast & voices", title: "Match the characters and their voices.",
    intro: "Merge names that refer to the same character, then compare voice auditions. Approving a voice saves the audition you selected.",
    route: ["Resolve uncertain identities", "Generate and compare auditions", "Approve individual or layered voices"],
    moves: [
      { cue: "A → B", title: "Merge matching characters", detail: "Drag one cast member onto another to combine their names into one character." },
      { cue: "A → N", title: "Use Narrator for a role", detail: "Drop a cast member onto Narrator when those dialogue lines should use the narrator voice." },
      { cue: "▶︎ A+B", title: "Choose a group voice", detail: "Give a group its own voice, or combine approved character voices." },
    ],
  },
  generate: {
    number: "05", label: "Generate", title: "Generate and listen to your chapters.",
    intro: "Generate uses your approved text and voices. Choose chapters, create their audio, and listen. If later edits affect a chapter, its audio is marked Needs update.",
    route: ["Select the chapters you want", "Generate chapter audio", "Listen; update chapters marked Needs update"],
    moves: [
      { cue: "☑", title: "Generate selectively", detail: "Try one chapter before generating the whole book." },
      { cue: "🔒", title: "Uses approved choices", detail: "The recording script uses your approved transcript, cast, and voices." },
      { cue: "↻", title: "Older recordings stay playable", detail: "Listen for comparison, then regenerate it before export so the chapter matches your current choices." },
    ],
  },
  export: {
    number: "06", label: "Export", title: "Export your audiobook.",
    intro: "Choose finished chapters, book details, and a format: high-quality M4B, smaller M4B, or MP3 chapters. Title, author, and cover changes apply only to this export.",
    route: ["Choose finished chapters", "Confirm the book details", "Choose a format and create it in your Library"],
    moves: [
      { cue: "☑", title: "Your chapter set", detail: "Export any finished chapters. They stay in book order." },
      { cue: "Aa", title: "Book details for this export", detail: "Title, author, and cover edits apply only to this export, not the source book." },
      { cue: "M4B", title: "Audiobook-ready choices", detail: "M4B keeps chapter navigation in one file. MP3 gives you a ZIP with one file per chapter." },
    ],
  },
};

export function PhaseHelp({ stage }: { stage: GuideStage }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const guide = guides[stage];

  const cueClassName = (move: HelpMove) => [
    "phase-help-cue",
    move.cueSub ? "has-subcue" : "",
    [...move.cue].length > 3 ? "is-compact" : "",
  ].filter(Boolean).join(" ");

  const close = () => setOpen(false);

  const dialog = open ? <DialogBackdrop className="phase-help-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <DialogSurface onDismiss={close} returnFocusRef={triggerRef} aria-labelledby={titleId} className={`phase-help phase-help-${stage}`}>
      <header className="phase-help-head" role="none">
        <div className="phase-help-number" aria-hidden="true">{guide.number}</div>
        <div><span className="eyebrow">{t("A quick guide to {{phase}}", { phase: t(guide.label) })}</span><h2 id={titleId}>{t(guide.title)}</h2></div>
        <button type="button" className="phase-help-close" aria-label={t("Close phase guide")} onClick={close}>×</button>
      </header>

      <div className="phase-help-body">
        <section className="phase-help-reading" aria-labelledby={`${titleId}-overview`}>
          <h3 id={`${titleId}-overview`}>{t("Overview")}</h3>
          <p>{t(guide.intro)}</p>
          <div className="phase-help-path">
            <strong>{t("Steps")}</strong>
            <ol>{guide.route.map((step) => <li key={step}>{t(step)}</li>)}</ol>
          </div>
        </section>
        <section className="phase-help-moves" aria-label={t("Worth knowing")}>
          <span className="eyebrow">{t("Worth knowing")}</span>
          <ul>{guide.moves.map((move) => <li key={move.title}><span className={cueClassName(move)} aria-hidden="true">{move.cueSub ? <><b>{move.cue}</b><small>{move.cueSub}</small></> : move.cue}</span><p><strong>{t(move.title)}.</strong> {t(move.detail)}</p></li>)}</ul>
        </section>
      </div>
    </DialogSurface>
  </DialogBackdrop> : null;

  return <>
    <button ref={triggerRef} type="button" className="phase-help-trigger" aria-label={t("About {{phase}}", { phase: t(guide.label) })} aria-haspopup="dialog" onClick={() => setOpen(true)}>?</button>
    {dialog}
  </>;
}
