import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installDiagnosticCapture } from "./lib/diagnostics";
import { INTEGRATED_QA, initializeIntegratedQa } from "./lib/integratedQa";

const container = document.getElementById("root") as HTMLElement;
const mount = () => {
  const disposeDiagnostics = installDiagnosticCapture(window);
  if (import.meta.hot) import.meta.hot.dispose(disposeDiagnostics);
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};

if (INTEGRATED_QA) {
  void initializeIntegratedQa().then(mount, () => {
    container.textContent = "Integrated QA is unavailable: native launch intent could not be verified.";
  });
} else {
  mount();
}
