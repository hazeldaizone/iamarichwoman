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
installEmergencyInteractions();

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

function installEmergencyInteractions() {
  const pageTitles = { overview: "總覽", trends: "趨勢", holdings: "股票", trade: "交易" };
  const status = (message, tone = "neutral") => {
    const el = document.getElementById("local-db-status");
    if (!el) return;
    el.classList.remove("hidden");
    el.innerHTML = `<strong class="${tone}">${escapeHtml(message)}</strong>`;
  };

  document.querySelectorAll("[data-screen], [data-nav]").forEach((button) => {
    if (button.dataset.loaderBound) return;
    button.dataset.loaderBound = "1";
    button.addEventListener("click", () => {
      const screen = button.dataset.screen || (button.dataset.nav === "calendar" ? "trends" : button.dataset.nav);
      document.querySelectorAll(".screen").forEach((el) => el.classList.toggle("active", el.id === `screen-${screen}`));
      document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.screen === screen));
      const title = document.getElementById("page-title");
      if (title) title.textContent = pageTitles[screen] || "總覽";
      if (button.dataset.nav === "calendar") {
        document.querySelectorAll("[data-trend-view]").forEach((el) => el.classList.toggle("active", el.dataset.trendView === "calendar"));
        document.querySelectorAll(".trend-view").forEach((el) => el.classList.toggle("active", el.id === "trend-calendar"));
      }
    });
  });

  const passwordButton = document.getElementById("backup-password-button");
  if (passwordButton && !passwordButton.dataset.loaderBound) {
    passwordButton.dataset.loaderBound = "1";
    passwordButton.addEventListener("click", async () => {
      const first = window.prompt("設定加密備份密碼。這個密碼不會存進備份檔，請自行記住。");
      if (!first) return;
      const second = window.prompt("再輸入一次備份密碼。");
      if (first !== second) return status("兩次密碼不同，尚未設定。", "loss");
      sessionStorage.setItem("assetBackupPassword", first);
      localStorage.setItem("assetBackupPasswordConfigured", "1");
      await localDb.setMeta("backupPasswordConfiguredAt", new Date().toISOString());
      status("備份密碼已設定於本次開啟期間。", "profit");
    });
  }

  const getPassword = () => {
    const saved = sessionStorage.getItem("assetBackupPassword");
    if (saved) return saved;
    const password = window.prompt("請輸入加密備份密碼。");
    if (!password) {
      status("未輸入備份密碼，無法執行。", "loss");
      return "";
    }
    sessionStorage.setItem("assetBackupPassword", password);
    return password;
  };

  const backupButton = document.getElementById("backup-now-button");
  if (backupButton && !backupButton.dataset.loaderBound) {
    backupButton.dataset.loaderBound = "1";
    backupButton.addEventListener("click", async () => {
      try {
        const password = getPassword();
        if (!password) return;
        const backup = await localDb.exportEncryptedBackup(password);
        window.__latestAssetBackup = backup;
        await localDb.setMeta("lastBackupDay", new Date().toISOString().slice(0, 10));
        status("已建立加密備份。", "profit");
      } catch (err) {
        status(`備份失敗：${err.message || err}`, "loss");
      }
    });
  }

  const downloadButton = document.getElementById("backup-download-button");
  if (downloadButton && !downloadButton.dataset.loaderBound) {
    downloadButton.dataset.loaderBound = "1";
    downloadButton.addEventListener("click", async () => {
      const backups = await localDb.getBackupRecords();
      const backup = window.__latestAssetBackup || backups.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      if (!backup) return status("目前沒有可匯出的備份，請先建立加密備份。", "loss");
      localDb.downloadBackup(backup);
      status("已下載加密備份檔。", "profit");
    });
  }

  const snapshotButton = document.getElementById("local-snapshot-button");
  if (snapshotButton && !snapshotButton.dataset.loaderBound) {
    snapshotButton.dataset.loaderBound = "1";
    snapshotButton.addEventListener("click", async () => {
      try {
        const dataset = await localDb.loadLocalDataset();
        await localDb.saveLocalDataset(recalculateDataset(dataset, { snapshot: true }));
        status("已建立本地快照，重新整理後會顯示最新結果。", "profit");
      } catch (err) {
        status(`建立快照失敗：${err.message || err}`, "loss");
      }
    });
  }

  const importButton = document.getElementById("bootstrap-import-button");
  if (importButton && !importButton.dataset.loaderBound) {
    importButton.dataset.loaderBound = "1";
    importButton.addEventListener("click", async () => {
      try {
        await localDb.reloadFromBootstrap();
        status("已重新匯入目前的 Sheet 匯出檔，重新整理後會顯示最新結果。", "profit");
      } catch (err) {
        status(`匯入失敗：${err.message || err}`, "loss");
      }
    });
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
