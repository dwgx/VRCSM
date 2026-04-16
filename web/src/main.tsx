import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./i18n";
import "./styles/globals.css";

document.documentElement.classList.add("dark");

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container #root missing in index.html");
}

createRoot(container).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
