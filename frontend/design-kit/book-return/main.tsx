import { createRoot } from "react-dom/client";
import App from "../../src/App";
import "../../src/i18n";
import "../../src/styles/product.css";
import { createFixtureGateway } from "../gatewayFixture";
import { persistWorkflowReturn } from "../../src/workflow/navigation";

const query = new URLSearchParams(location.search);
const gateway = createFixtureGateway("dialogue-accepted");
const getSnapshot = gateway.getBookSnapshot;
let release: () => void;
const waiting = new Promise<void>(resolve => { release = resolve; });
Object.assign(window, { finishBookPreview: () => release() });
gateway.getBookSnapshot = async (...args) => { await waiting; return getSnapshot(...args); };
gateway.processStage = async () => { throw new Error("Design preview never starts provider work"); };
persistWorkflowReturn("kit-book", "dialogue", { namespace: "book-return-design-preview" });
createRoot(document.getElementById("root")!).render(<App gateway={gateway} workflowPersistenceNamespace="book-return-design-preview" appearance={query.get("appearance") === "dark" ? "dark" : "light"} />);
