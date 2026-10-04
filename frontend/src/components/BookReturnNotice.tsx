import { Component, lazy, Suspense, type ReactNode } from "react";
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
  return <section className="book-return" role="status" aria-live="polite" aria-atomic="true">
    <SakuraAtmosphere />
    <div className="book-return-art" aria-hidden="true">
      <BookArtBoundary>
        <Suspense fallback={<StaticBook />}><AnimatedBook appearance={appearance} /></Suspense>
      </BookArtBoundary>
    </div>
    <h1>{t("Opening your book")}</h1>
  </section>;
}
