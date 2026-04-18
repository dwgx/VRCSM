import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { APP_ICON_URL } from "./lib/assets";
import "./i18n";
import "./styles/globals.css";

document.documentElement.classList.add("dark");

const faviconId = "vrcsm-app-icon";
let faviconLink = document.getElementById(faviconId) as HTMLLinkElement | null;
if (!faviconLink) {
  faviconLink = document.createElement("link");
  faviconLink.id = faviconId;
  faviconLink.rel = "icon";
  document.head.appendChild(faviconLink);
}
faviconLink.href = APP_ICON_URL;

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
