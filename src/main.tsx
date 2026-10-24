import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installDiagnosticCapture } from "./lib/diagnostics";

const disposeDiagnostics = installDiagnosticCapture(window);
if (import.meta.hot) import.meta.hot.dispose(disposeDiagnostics);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
