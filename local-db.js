const DB_NAME = "asset-overview-local";
const DB_VERSION = 1;
const DATASET_KEY = "dataset";
const META_STORE = "meta";
const BACKUP_STORE = "backups";
const BOOTSTRAP_PATH = "./bootstrap-data.json";
const BACKUP_VERSION = 1;
const EMPTY_DATASET = Object.freeze({
  schemaVersion: 1,
  source: "empty-public-pwa",
  exportedAt: "",
  data: {
    trend: [],
    overview: [],
    stocks: [],
    transactions: [],
    retirement: [],
    dailyAssetSnapshots: [],
    dailyHoldings: [],
    dailyPrices: [],
  },
});

let dbPromise = null;

export async function loadLocalDataset() {
  const db = await openDb();
  let dataset = await getValue(db, META_STORE, DATASET_KEY);
  if (!dataset) {
    dataset = await loadBootstrapDataset();
    await saveLocalDataset(dataset);
    await setMeta("createdAt", new Date().toISOString());
  } else if (needsHistoricalMerge(dataset)) {
    const bootstrap = await loadBootstrapDataset();
    dataset = mergeHistoricalTables(dataset, bootstrap);
    await saveLocalDataset(dataset);
    await setMeta("historicalMergedAt", new Date().toISOString());
  }
  return dataset;
}

export async function reloadFromBootstrap() {
  const dataset = await loadBootstrapDataset();
  await saveLocalDataset(dataset);
  await setMeta("lastImportedAt", new Date().toISOString());
  return dataset;
}

export async function saveLocalDataset(dataset) {
  const db = await openDb();
  const next = {
    schemaVersion: dataset?.schemaVersion || 1,
    source: dataset?.source || "local",
    exportedAt: dataset?.exportedAt || new Date().toISOString(),
    data: {
      trend: dataset?.data?.trend || [],
      overview: dataset?.data?.overview || [],
      stocks: dataset?.data?.stocks || [],
      transactions: dataset?.data?.transactions || [],
      retirement: dataset?.data?.retirement || [],
      dailyAssetSnapshots: dataset?.data?.dailyAssetSnapshots || [],
      dailyHoldings: dataset?.data?.dailyHoldings || [],
      dailyPrices: dataset?.data?.dailyPrices || [],
    },
  };
  await putValue(db, META_STORE, next, DATASET_KEY);
  await setMeta("updatedAt", new Date().toISOString());
  return next;
}

export async function getMeta(key) {
  return getValue(await openDb(), META_STORE, key);
}

export async function setMeta(key, value) {
  return putValue(await openDb(), META_STORE, value, key);
}

export async function getBackupRecords() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, "readonly");
    const request = tx.objectStore(BACKUP_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function exportEncryptedBackup(password) {
  const dataset = await loadLocalDataset();
  const backup = await encryptBackup(dataset, password);
  await saveBackupRecord(backup);
  await setMeta("lastBackupAt", backup.createdAt);
  return backup;
}

export async function maybeAutoBackup(password) {
  if (!password) return { skipped: true, reason: "尚未設定備份密碼" };

  const now = new Date();
  const todayKey = dateKey(now);
  const lastBackupDay = await getMeta("lastBackupDay");
  const hasBackups = (await getBackupRecords()).length > 0;
  const shouldBackup = !hasBackups || (now.getHours() >= 14 && lastBackupDay !== todayKey);
  if (!shouldBackup) return { skipped: true, reason: "今日尚未到自動備份時間或已備份" };

  const backup = await exportEncryptedBackup(password);
  await setMeta("lastBackupDay", todayKey);
  return { skipped: false, backup };
}

export async function restoreEncryptedBackup(file, password) {
  const backup = JSON.parse(await file.text());
  const dataset = await decryptBackup(backup, password);
  await saveLocalDataset(dataset);
  await setMeta("lastRestoredAt", new Date().toISOString());
  return dataset;
}

export function downloadBackup(backup) {
  const name = backup?.name || `asset-backup-${dateKey(new Date())}.assetbackup`;
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadBootstrapDataset() {
  const response = await fetch(BOOTSTRAP_PATH, { cache: "no-cache" });
  if (!response.ok) return emptyDataset();
  return response.json();
}

function emptyDataset() {
  return {
    ...EMPTY_DATASET,
    exportedAt: new Date().toISOString(),
    data: {
      ...EMPTY_DATASET.data,
      trend: [],
      overview: [],
      stocks: [],
      transactions: [],
      retirement: [],
      dailyAssetSnapshots: [],
      dailyHoldings: [],
      dailyPrices: [],
    },
  };
}

function needsHistoricalMerge(dataset) {
  const data = dataset?.data || {};
  return !data.dailyAssetSnapshots?.length || !data.dailyHoldings?.length || !data.dailyPrices?.length;
}

function mergeHistoricalTables(dataset, bootstrap) {
  const data = dataset?.data || {};
  const source = bootstrap?.data || {};
  return {
    ...dataset,
    data: {
      ...data,
      dailyAssetSnapshots: data.dailyAssetSnapshots?.length ? data.dailyAssetSnapshots : (source.dailyAssetSnapshots || []),
      dailyHoldings: data.dailyHoldings?.length ? data.dailyHoldings : (source.dailyHoldings || []),
      dailyPrices: data.dailyPrices?.length ? data.dailyPrices : (source.dailyPrices || []),
    },
  };
}

async function saveBackupRecord(backup) {
  const db = await openDb();
  return putValue(db, BACKUP_STORE, backup, backup.id);
}

async function encryptBackup(dataset, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(dataset));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const createdAt = new Date().toISOString();
  const id = `backup-${createdAt.replace(/[:.]/g, "-")}`;
  return {
    schemaVersion: BACKUP_VERSION,
    id,
    name: `asset-backup-${createdAt.slice(0, 10)}.assetbackup`,
    createdAt,
    algorithm: "PBKDF2-SHA256-AES-GCM",
    iterations: 210000,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptBackup(backup, password) {
  if (!backup?.salt || !backup?.iv || !backup?.ciphertext) {
    throw new Error("備份檔格式不正確");
  }
  const key = await deriveKey(password, base64ToBytes(backup.salt), backup.iterations || 210000);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(backup.iv) },
    key,
    base64ToBytes(backup.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function deriveKey(password, salt, iterations = 210000) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(BACKUP_STORE)) db.createObjectStore(BACKUP_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function getValue(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putValue(db, storeName, value, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const request = tx.objectStore(storeName).put(value, key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
