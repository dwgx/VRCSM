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

// Fade out the inline splash after the first paint. Minimum on-screen
// time keeps the anim from strobing on fast loads; the CSS transition
// handles the actual dissolve and we remove the node once it finishes.
const splash = document.getElementById("vrcsm-splash");
if (splash) {
  const fadeStart = performance.now();
  const minVisibleMs = 650;
  const start = () => {
    const held = performance.now() - fadeStart;
    const delay = Math.max(0, minVisibleMs - held);
    window.setTimeout(() => {
      document.documentElement.setAttribute("data-splash-done", "1");
      splash.addEventListener(
        "transitionend",
        () => {
          splash.remove();
        },
        { once: true },
      );
      // Safety: bounce anyway if transitionend never fires (e.g. reduce-motion).
      window.setTimeout(() => splash.remove(), 900);
    }, delay);
  };
  if (document.readyState === "complete") {
    start();
  } else {
    window.addEventListener("load", start, { once: true });
  }
}
