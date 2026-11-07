import React from "react";
import { createRoot } from "react-dom/client";
import "@vscode/codicons/dist/codicon.css";
import "katex/dist/katex.min.css";
// fonts are bundled (not loaded from a CDN) so the app looks the same offline and behind any firewall
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
