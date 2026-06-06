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
const RUNTIME_GZIP_BASE64 = "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";

const runtimeSource = await loadRuntimeSource();

installLocalActionIcons();
installEmergencyInteractions();

new Function("localDb", "recalculateDataset", `${runtimeSource}
//# sourceURL=asset-pwa-runtime.js
`)(localDb, recalculateDataset);

if (document.readyState !== "loading") {
  document.dispatchEvent(new Event("DOMContentLoaded"));
}

async function loadRuntimeSource() {
  if ("DecompressionStream" in globalThis) {
    const bytes = Uint8Array.from(atob(RUNTIME_GZIP_BASE64), (ch) => ch.charCodeAt(0));
    const stream = new Response(bytes).body.pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }
  const chunks = await Promise.all(APP_RUNTIME_CHUNKS.map(async (name) => {
    const module = await import(`./${name}?v=19`);
    return module.default;
  }));
  return chunks.join("");
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
    if (id === "bootstrap-import-button") {
      button.replaceChildren(document.createTextNode("匯入Sheet檔"));
    }
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
  const sheetImportInput = ensureSheetImportInput();
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

  document.querySelectorAll("[data-trend-view]").forEach((button) => {
    if (button.dataset.loaderBound) return;
    button.dataset.loaderBound = "1";
    button.addEventListener("click", () => {
      const view = button.dataset.trendView;
      document.querySelectorAll("[data-trend-view]").forEach((el) => el.classList.toggle("active", el.dataset.trendView === view));
      document.querySelectorAll(".trend-view").forEach((el) => el.classList.toggle("active", el.id === `trend-${view}`));
    });
  });

  document.querySelectorAll("[data-trend-range]").forEach((button) => {
    if (button.dataset.loaderBound) return;
    button.dataset.loaderBound = "1";
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-trend-range]").forEach((el) => el.classList.toggle("active", el === button));
    });
  });

  document.querySelectorAll("[data-trend-series]").forEach((button) => {
    if (button.dataset.loaderBound) return;
    button.dataset.loaderBound = "1";
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-trend-series]").forEach((el) => el.classList.toggle("active", el === button));
    });
  });

  document.querySelectorAll("[data-calendar-mode]").forEach((button) => {
    if (button.dataset.loaderBound) return;
    button.dataset.loaderBound = "1";
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-calendar-mode]").forEach((el) => el.classList.toggle("active", el === button));
    });
  });

  document.querySelectorAll("[data-market]").forEach((button) => {
    if (button.dataset.loaderBound) return;
    button.dataset.loaderBound = "1";
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-market]").forEach((el) => el.classList.toggle("active", el === button));
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
    importButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      sheetImportInput?.click();
    }, true);
  }

  if (sheetImportInput && !sheetImportInput.dataset.loaderBound) {
    sheetImportInput.dataset.loaderBound = "1";
    sheetImportInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        await localDb.importDatasetFile(file);
        status(`已匯入 ${file.name}，資料已寫入本機 IndexedDB。`, "profit");
        window.setTimeout(() => window.location.reload(), 500);
      } catch (err) {
        status(`匯入失敗：${err.message || err}`, "loss");
      }
    });
  }
}

function ensureSheetImportInput() {
  let input = document.getElementById("sheet-import-input");
  if (input) return input;
  input = document.createElement("input");
  input.id = "sheet-import-input";
  input.type = "file";
  input.accept = ".xlsx,.xls,.json,application/json";
  input.className = "hidden-file-input";
  input.style.display = "none";
  document.body.appendChild(input);
  return input;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
