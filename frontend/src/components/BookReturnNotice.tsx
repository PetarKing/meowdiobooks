import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SakuraAtmosphere } from "./book-return/SakuraAtmosphere";
import { StaticBook } from "./book-return/StaticBook";

const AnimatedBook = lazy(() => import("./book-return/AnimatedBook"));

// Decoration must never turn a failed chunk or graphics context into a failed
// workflow. The heading and the actual return state stay outside this boundary.
class BookArtBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <StaticBook /> : this.props.children; }
}

export function BookReturnNotice({ appearance }: { appearance: "light" | "dark" }) {
  const { t } = useTranslation();
  const [showArt, setShowArt] = useState(false);
  useEffect(() => {
    // Fast restores need a quiet status, not a flash of a whole loading scene.
    // This delays decoration only; the workflow never waits for this timer.
    const timer = window.setTimeout(() => setShowArt(true), 800);
    return () => window.clearTimeout(timer);
  }, []);
  return <section className={`book-return${showArt ? "" : " book-return-quiet"}`} role="status" aria-live="polite" aria-atomic="true">
    {showArt && <SakuraAtmosphere />}
    {showArt && <div className="book-return-art" aria-hidden="true">
      <BookArtBoundary>
        <Suspense fallback={<StaticBook />}><AnimatedBook appearance={appearance} /></Suspense>
      </BookArtBoundary>
    </div>}
    <h1>{t("Opening your book")}</h1>
  </section>;
}
