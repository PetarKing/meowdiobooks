import { createRoot } from "react-dom/client";
import { StudioPreviewApp } from "./StudioPreviewApp";
import "../src/i18n";
import "../src/styles/product.css";
import "./studioPreview.css";

// Keep fixture navigation inside this preview even after a browser refresh.
window.history.pushState = () => {};
window.history.replaceState = () => {};
createRoot(document.getElementById("root")!).render(<StudioPreviewApp />);
