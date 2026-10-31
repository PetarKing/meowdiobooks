import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppearance, type Appearance } from "../app/useAppearance";
import { PresentationRoot } from "../components/PresentationRoot";
import { ThemeToggle } from "../components/ThemeToggle";
import { LanguageToggle } from "../components/LanguageToggle";
import { DitherScene } from "../components/agent-guide/DitherScene";
import "./AgentGuide.css";
import { BrandWordmark } from "../components/Brand";

export type AgentGuideLocale = "en" | "zh-CN";
/** Product-facing edition policy. Keep provider and infrastructure details in the host. */
export type AgentGuideEdition = Record<AgentGuideLocale, {
  jobs: string;
  storage: string;
  costs?: string;
}>;

const copy = {
  en: {
    title: "Agent guide", back: "Back to the studio",
    expand: "Expand all", collapse: "Collapse all", pause: "Pause background animation", play: "Resume background animation",
    inputTitle: "Import and script cleanup",
    input: "Upload a PDF, EPUB, TXT or Markdown file the user has permission to turn into audio. Meowdiobooks provides text extraction, cleanup and speaker identification during the workflow. You can upload the original and use the service for these steps.",
    preparation: "If preparing a clean script is an option and the user agrees, doing so first is more reliable and can reduce repeat processing. Separate speakers and narration, use consistent names, and preserve the words and reading order. Leave uncertain speakers for review. Helper agents can prepare separate chapters if that fits the user's assistant or API budget. If preparation is not practical, rely on the service's cleanup and review instead.",
    before: "Original text", after: "Prepared script", exampleNote: "Keep narration separate from dialogue. Add labels only where the source identifies the speaker.",
    reviewTitle: "Review",
    review: "Check the extracted text, chapter boundaries and speaker suggestions before accepting. Review supports individual decisions and bulk actions for recurring cases. These balance efficiency and accuracy, but may miss exceptions. Inspect examples before applying a bulk choice; the examples may not cover every occurrence.",
    precision: "For higher precision, review uncertain passages and speaker changes individually. Agree the level of checking with the user before proceeding.",
    voicesTitle: "Voices and samples",
    voices: "In Cast & voices, reuse voices from other available books when offered. Check the language, character match and audition; keep the source book available until reuse is complete.",
    sample: "Listen to a sample before generating many chapters. Check pronunciation, speakers, pacing and voice fit. If you cannot listen, ask the user to check. Changing accepted text or voices can require later work to be repeated.",
    jobsTitle: "Background jobs",
    recovery: "Wait for uploads and saves to finish before leaving. Return to the same book and check its status before retrying. Slow progress alone is not a reason to submit again. Use the offered recovery action if a job fails.",
    storageTitle: "Storage and downloads",
    handoff: "When handing back, report the book's current step, any remaining review and the download location. Confirm the user has saved the audio they want to keep.",
    costsTitle: "Costs and approval",
    localCosts: "Browsing saved results and playing existing audio do not incur API charges. Speech generation runs locally. AI cleanup Review and any selected remote processing use the configured API account when those jobs run, and the provider may bill that usage. Agree an API budget for the requested work, then continue within it; reading the page or returning to a running job does not start it again.",
    consent: "Use the budget and scope the user has already approved. Ask before exceeding either or deleting work.",
    localJobs: "Text preparation, voice auditions, generation and export run in the local application. You can return to the book in the browser, but keep Meowdiobooks and the computer running while it works.",
    localStorage: "Working books and Library exports are stored locally, limited by available disk space. Deleting working files preserves completed Library exports. Save finished audio through the Library and keep your own backups.",
  },
  "zh-CN": {
    title: "智能体指南", back: "返回制作室",
    expand: "全部展开", collapse: "全部收起", pause: "暂停背景动画", play: "继续背景动画",
    inputTitle: "导入与脚本整理",
    input: "上传用户有权制作成音频的 PDF、EPUB、TXT 或 Markdown 文件。Meowdiobooks 在制作流程中提供文字提取、整理和说话者识别。可以直接上传原文件，由服务完成这些步骤。",
    preparation: "如果条件允许且用户同意，预先整理脚本更可靠，也能减少重复处理。分开对话与旁白，统一说话者名称，保留原文和阅读顺序，无法确定的说话者留待审核。如果符合用户的助手用量或 API 预算，可以让辅助智能体分别整理不同章节。不方便预先整理时，直接使用服务的整理和审核功能即可。",
    before: "原文", after: "整理后的脚本", exampleNote: "旁白与对话分开。只在原文能确定说话者时添加标签。",
    reviewTitle: "审核",
    review: "确认前检查提取文字、章节边界和说话者建议。审核支持逐条决定，也支持批量处理重复情况。这些功能兼顾效率和准确性，但可能遗漏例外。批量应用前先检查示例；示例未必涵盖全部情况。",
    precision: "需要更高精度时，逐条检查不确定段落和说话者切换。继续前先与用户确认所需的检查程度。",
    voicesTitle: "声音与试听",
    voices: "在“角色与声音”中，如果提供复用选项，可从其他可用书籍复用声音。检查语言、角色对应和试听；复用完成前保留来源书籍。",
    sample: "批量生成前，试听样本的发音、说话者、节奏和声音是否合适。无法试听时，请用户检查。修改已确认的文字或声音可能需要重做后续工作。",
    jobsTitle: "后台任务",
    recovery: "离开前等待上传和保存完成。返回同一本书，查看状态后再决定是否重试。进度缓慢本身不代表需要重新提交。任务失败时，使用页面提供的恢复操作。",
    storageTitle: "存储与下载",
    handoff: "交还用户时，说明书籍当前步骤、待审核内容和下载位置。确认用户已保存想保留的音频。",
    costsTitle: "费用与授权",
    localCosts: "查看已保存的结果和播放已有音频不会产生 API 费用。语音生成在本地运行。AI 文字整理审核及所选的远程处理会在任务运行时使用配置的 API 账户，供应商可能按用量收费。先与用户约定本次任务的 API 预算，再在预算内继续；查看页面或返回运行中的任务不会重新启动处理。",
    consent: "使用用户已批准的预算和任务范围。超出预算、扩大范围或删除工作前，先询问用户。",
    localJobs: "文字整理、声音试听、生成和导出在本地应用中运行。可以通过浏览器返回书籍，但处理期间需保持 Meowdiobooks 和电脑运行。",
    localStorage: "制作中的书籍和书库导出保存在本地，受可用磁盘空间限制。删除工作文件会保留书库成品。通过书库保存音频，并自行备份。",
  },
};

export interface AgentGuideProps {
  edition?: AgentGuideEdition;
  footer?: ReactNode;
  appearance?: Appearance;
  onAppearanceChange?: (appearance: Appearance) => void;
}

export function AgentGuide({ edition, footer, appearance: suppliedAppearance, onAppearanceChange }: AgentGuideProps) {
  const { i18n } = useTranslation();
  const language: AgentGuideLocale = i18n.resolvedLanguage?.startsWith("zh") ? "zh-CN" : "en";
  const text = copy[language];
  const policy = edition?.[language];
  const { appearance, resolvedAppearance, setAppearance } = useAppearance(suppliedAppearance, onAppearanceChange);
  const topics = useRef<HTMLDivElement>(null);
  const [motionPaused, setMotionPaused] = useState(false);
  useEffect(() => {
    document.title = `${text.title} · Meowdiobooks`;
    document.documentElement.lang = language;
    document.documentElement.style.backgroundColor = resolvedAppearance === "dark" ? "#293f33" : "#f1f2e8";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolvedAppearance === "dark" ? "#293f33" : "#f1f2e8");
  }, [language, resolvedAppearance, text.title]);
  useEffect(() => {
    const revealTopic = () => {
      const topic = window.location.hash && document.getElementById(window.location.hash.slice(1));
      if (topic instanceof HTMLDetailsElement) { topic.open = true; topic.scrollIntoView?.(); }
    };
    revealTopic();
    window.addEventListener("hashchange", revealTopic);
    return () => window.removeEventListener("hashchange", revealTopic);
  }, []);
  function toggleAll(open: boolean) {
    topics.current?.querySelectorAll("details").forEach(topic => { topic.open = open; });
  }
  const rows = [
    { id: "clean-script", title: text.inputTitle, body: <>
      <p>{text.input}</p><p>{text.preparation}</p><div className="agent-guide-examples">
        <figure><figcaption>{text.before}</figcaption><pre>{'“Are we ready?” Alice asked.\n“Yes,” Ben replied.'}</pre></figure>
        <figure><figcaption>{text.after}</figcaption><pre>{'Alice: “Are we ready?”\nAlice asked.\n\nBen: “Yes,”\nBen replied.'}</pre></figure>
      </div><p className="agent-guide-caption">{text.exampleNote}</p>
    </> },
    { id: "review", title: text.reviewTitle, body: <><p>{text.review}</p><p>{text.precision}</p></> },
    { id: "voices", title: text.voicesTitle, body: <><p>{text.voices}</p><p>{text.sample}</p></> },
    { id: "background-jobs", title: text.jobsTitle, body: <><p>{policy?.jobs ?? text.localJobs}</p><p>{text.recovery}</p></> },
    { id: "storage", title: text.storageTitle, body: <><p>{policy?.storage ?? text.localStorage}</p><p>{text.handoff}</p></> },
    { id: "user-choices", title: text.costsTitle, body: <><p>{policy?.costs ?? text.localCosts}</p><p>{text.consent}</p></> },
  ];
  return <PresentationRoot className="agent-guide" appearance={resolvedAppearance}>
    <DitherScene paused={motionPaused} />
    <header className="agent-guide-header">
      <a className="agent-guide-brand" href="/"><BrandWordmark /></a>
      <div className="agent-guide-preferences">
        <button type="button" className="theme-toggle" aria-label={motionPaused ? text.play : text.pause} title={motionPaused ? text.play : text.pause} aria-pressed={motionPaused} onClick={() => setMotionPaused(value => !value)}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">{motionPaused ? <path d="m9 5 11 7-11 7Z" /> : <><path d="M8 5v14M16 5v14" /></>}</svg>
        </button>
        <ThemeToggle appearance={appearance} onChange={setAppearance} /><LanguageToggle />
      </div>
    </header>
    <main className="agent-guide-main">
      <a className="agent-guide-back" href="/">← {text.back}</a>
      <div className="agent-guide-heading"><h1>{text.title}</h1>
        <div className="agent-guide-tools"><button type="button" onClick={() => toggleAll(true)}>{text.expand}</button><button type="button" onClick={() => toggleAll(false)}>{text.collapse}</button></div>
      </div>
      <div className="agent-guide-topics" ref={topics}>{rows.map((row, index) => <details id={row.id} key={row.id} open={index === 0}>
        <summary><h2>{row.title}</h2><span className="agent-guide-plus" aria-hidden="true" /></summary>
        <div className="agent-guide-body">{row.body}</div>
      </details>)}</div>
    </main>
    {footer}
  </PresentationRoot>;
}
