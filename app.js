import * as localDb from "./local-db.js";
import { recalculateDataset } from "./local-calculator.js";

const APP_RUNTIME_CHUNKS = [
  "app-runtime-01.js",
  "app-runtime-02.js",
  "app-runtime-03.js",
  "app-runtime-04.js",
  "app-runtime-05.js",
  "app-runtime-06.js",
  "app-runtime-07.js",
  "app-runtime-08.js"
];

const runtimeSource = await Promise.all(
  APP_RUNTIME_CHUNKS.map(async (name) => {
    const response = await fetch(new URL(name, import.meta.url), { cache: "no-cache" });
    if (!response.ok) throw new Error(`PWA 載入失敗：${name}`);
    return response.text();
  }),
);

installLocalActionIcons();

new Function("localDb", "recalculateDataset", `${runtimeSource.join("")}
//# sourceURL=asset-pwa-runtime.js
`)(localDb, recalculateDataset);

if (document.readyState !== "loading") {
  document.dispatchEvent(new Event("DOMContentLoaded"));
}

function installLocalActionIcons() {
  const icons = {
    "backup-password-button": '<svg viewBox="0 0 24 24"><path d="M15.5 7.5a4 4 0 1 0-2.1 3.5L15 12.6V15h2.4l1.2 1.2H21v-2.8l-5.5-5.9Z"/><path d="M8 8h.01"/></svg>',
    "backup-now-button": '<svg viewBox="0 0 24 24"><path d="M7 11V8a5 5 0 0 1 10 0v3"/><path d="M6 11h12v10H6z"/><path d="M12 15v3"/></svg>',
    "backup-download-button": '<svg viewBox="0 0 24 24"><path d="M12 3v11"/><path d="m8 10 4 4 4-4"/><path d="M5 19h14"/></svg>',
    "local-snapshot-button": '<svg viewBox="0 0 24 24"><path d="M7 7h2l1.5-2h3L15 7h2a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3Z"/><path d="M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>',
    "bootstrap-import-button": '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M4 10h16"/><path d="M9 5v14"/><path d="M15 5v14"/></svg>',
  };

  const style = document.createElement("style");
  style.textContent = `
    .local-actions .secondary-button::before{content:none!important;display:none!important}
    .local-actions .action-icon{display:inline-grid;flex:0 0 18px;width:18px;height:18px;place-items:center;border-radius:999px;color:#111113}
    .local-actions .action-icon svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}
    .local-actions .secondary-button:nth-child(1) .action-icon{background:#d9b46f}
    .local-actions .secondary-button:nth-child(2) .action-icon{background:#6fc2a4}
    .local-actions .secondary-button:nth-child(3) .action-icon{background:#6d79ff;color:white}
    .local-actions .secondary-button:nth-child(4) .action-icon{background:#f2b33d}
    .local-actions .secondary-button:nth-child(5) .action-icon{background:#60a5fa;color:white}
    .local-actions .secondary-button:nth-child(6) .action-icon{background:#74747e;color:white}
  `;
  document.head.appendChild(style);

  for (const [id, svg] of Object.entries(icons)) {
    const button = document.getElementById(id);
    if (!button || button.querySelector(".action-icon")) continue;
    const icon = document.createElement("span");
    icon.className = "action-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = svg;
    button.prepend(icon);
  }

  const restoreInput = document.getElementById("backup-restore-input");
  const restoreButton = restoreInput?.closest(".file-button");
  if (restoreButton && !restoreButton.querySelector(".action-icon")) {
    const icon = document.createElement("span");
    icon.className = "action-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 21V10"/><path d="m8 14 4-4 4 4"/><path d="M5 5h14"/></svg>';
    restoreButton.prepend(icon);
  }
}
