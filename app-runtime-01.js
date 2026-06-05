const {
  downloadBackup,
  exportEncryptedBackup,
  getBackupRecords,
  getMeta,
  loadLocalDataset,
  maybeAutoBackup,
  reloadFromBootstrap,
  restoreEncryptedBackup,
  saveLocalDataset,
  setMeta,
} = localDb;
const DATA_PATHS = {
  trend: "../data/asset_trend.csv",
  overview: "../data/asset_overview.csv",
  stocks: "../data/stock_summary.csv",
  transactions: "../data/transactions.csv",
};

const API_TIMEOUT_MS = 15000;

const state = {
  trend: [],
  overview: [],
  stocks: [],
  transactions: [],
  dailyAssetSnapshots: [],
  dailyHoldings: [],
  dailyPrices: [],
  activeMarket: "台股",
  detailTab: "lots",
  calendarMode: "total",
  calendarDate: new Date(),
  activeTrendSeries: "netWorth",
  activeTrendRange: "30",
  retirementGoal: 20188025,
  pendingAssetEdit: null,
  remoteDetailCache: new Map(),
  dataset: null,
  latestBackup: null,
};

const money = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat("zh-TW", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const pageTitles = {
  overview: "總覽",
  trends: "趨勢",
  holdings: "股票",
  trade: "交易",
};

const TREND_SERIES = {
  netWorth: { label: "淨資產", field: "netWorth", pnl: "totalPnl", rate: "totalRate", color: "#d9b46f" },
  tw: { label: "台股", field: "tw", pnl: "twPnl", rate: "twRate", color: "#6fc2a4" },
  us: { label: "美股", field: "us", pnl: "usPnl", rate: "usRate", color: "#6d79ff" },
  cash: { label: "流動資金", field: "cash", pnl: "cashPnl", rate: "cashRate", color: "#f2b33d" },
};

document.addEventListener("DOMContentLoaded", async () => {
  bindAuthForm();
  bindNavigation();
  bindTrendTabs();
  bindTrendControls();
  bindCalendarControls();
  bindMarketTabs();
  bindTradeForm();
  bindAssetEditForm();
  bindRefresh();
  bindLocalDataControls();
  registerServiceWorker();
  if (needsAuth()) {
    showAuthScreen();
    return;
  }
  await loadData().catch(showAppError);
});

async function loadData() {
  await loadIndexedDbData();
  hideAppError();
  renderAll();
  await runAutoBackup().catch((err) => updateLocalDbStatus(`自動備份略過：${err.message || err}`, "neutral"));
}

async function loadIndexedDbData() {
  applyDataset(await loadLocalDataset());
}

function applyDataset(dataset) {
  state.dataset = dataset;
  const data = dataset?.data || {};
  state.trend = normalizeTrend(data.trend || []);
  state.overview = data.overview || [];
  state.stocks = (data.stocks || []).map(normalizeStock).filter(Boolean);
  state.transactions = (data.transactions || []).map(normalizeTransaction).filter(Boolean);
  state.dailyAssetSnapshots = (data.dailyAssetSnapshots || []).map(normalizeDailyAssetSnapshot).filter(Boolean);
  state.dailyHoldings = data.dailyHoldings || [];
  state.dailyPrices = data.dailyPrices || [];
  state.retirementGoal = toNumber(localStorage.getItem("retirementGoal")) || retirementGoalFromRows(data.retirement) || state.retirementGoal;

  const latest = state.trend[state.trend.length - 1];
  if (latest) state.calendarDate = new Date(latest.date.getFullYear(), latest.date.getMonth(), 1);
  updateLocalDbSource(dataset);
}

async function loadCsvData() {
  const [trend, overview, stocks, transactions] = await Promise.all([
    fetchCsv(DATA_PATHS.trend),
    fetchCsv(DATA_PATHS.overview),
    fetchCsv(DATA_PATHS.stocks),
    fetchCsv(DATA_PATHS.transactions),
  ]);

  state.trend = normalizeTrend(trend);
  state.overview = overview;
  state.stocks = stocks.map(normalizeStock).filter(Boolean);
  state.transactions = transactions.map(normalizeTransaction).filter(Boolean);
  state.retirementGoal = toNumber(localStorage.getItem("retirementGoal")) || state.retirementGoal;

  const latest = state.trend[state.trend.length - 1];
  if (latest) state.calendarDate = new Date(latest.date.getFullYear(), latest.date.getMonth(), 1);
}

async function loadRemoteData() {
  const [appData, trendData] = await Promise.all([
    apiRun("getAppData"),
    apiRun("getAssetTrendData", { limit: 1000 }),
  ]);
  if (appData?.error) throw new Error(appData.error);

  state.overview = normalizeApiOverview(appData);
  state.stocks = normalizeApiStocks(appData);
  state.transactions = [];
  state.retirementGoal = toNumber(appData?.retirementGoal) || state.retirementGoal;
  state.remoteDetailCache.clear();
  state.trend = normalizeTrendRowsFromApi(trendData?.rows?.length ? trendData.rows : appData?.trendRows || []);

  const latest = state.trend[state.trend.length - 1];
  if (latest) state.calendarDate = new Date(latest.date.getFullYear(), latest.date.getMonth(), 1);
}

async function fetchCsv(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`讀取失敗：${path}`);
  return parseCsv(await res.text());
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (quoted && ch === '"' && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    if (row.some(Boolean)) rows.push(row);
  }

  const headers = rows.shift() || [];
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h.trim(), r[i] ?? ""])));
}

function normalizeTrend(rows) {
  const normalized = rows
    .map((row) => {
      const dateRaw = row["日期"] || row["時間"];
      const date = parseDate(dateRaw);
      if (!date) return null;

      return {
        date,
        snapshotTime: row["快照時間"] || row["時間"] || "",
        netWorth: toNumber(row["淨資產"]),
        tw: toNumber(row["台股"]),
        us: toNumber(row["美股"]),
        cash: toNumber(row["流動資金"] || row["存款"]),
        totalPnl: toNumber(row["每日損益"]),
        totalRate: toRate(row["每日報酬率"]),
        twPnl: toNumber(row["台股每日損益"]),
        twRate: toRate(row["台股每日報酬率"]),
        usPnl: toNumber(row["美股每日損益"]),
        usRate: toRate(row["美股每日報酬率"]),
        cumulativeRate: toRate(row["累積報酬率"]),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);

  normalized.forEach((row, index) => {
    const prev = normalized[index - 1];
    row.rawTotalPnl = row.totalPnl;
    row.rawTotalRate = row.totalRate;
    row.rawTwPnl = row.twPnl;
    row.rawTwRate = row.twRate;
    row.rawUsPnl = row.usPnl;
    row.rawUsRate = row.usRate;
    if (!prev) {
      row.totalPnl = row.totalPnl || 0;
      row.totalRate = row.totalRate || 0;
      row.twPnl = row.twPnl || 0;
      row.twRate = row.twRate || 0;
      row.usPnl = row.usPnl || 0;
      row.usRate = row.usRate || 0;
      row.cashPnl = row.cashPnl || 0;
      row.cashRate = row.cashRate || 0;
      return;
    }
    row.totalPnl = row.netWorth - prev.netWorth;
    row.totalRate = safeRate(row.totalPnl, prev.netWorth);
    row.twPnl = row.tw - prev.tw;
    row.twRate = safeRate(row.twPnl, prev.tw);
    row.usPnl = row.us - prev.us;
    row.usRate = safeRate(row.usPnl, prev.us);
    row.cashPnl = row.cash - prev.cash;
    row.cashRate = safeRate(row.cashPnl, prev.cash);
  });

  return normalized;
}

function normalizeTrendRowsFromApi(rows) {
  return normalizeTrend(rows.map((row) => ({
    "日期": row["日期"] || row.date,
    "快照時間": row["快照時間"] || row.snapshotTime,
    "淨資產": row["淨資產"] ?? row.netWorth,
    "台股": row["台股"] ?? row.tw,
    "美股": row["美股"] ?? row.us,
    "流動資金": row["流動資金"] ?? row.cash,
    "每日損益": row["每日損益"] ?? row.totalPnl,
    "每日報酬率": row["每日報酬率"] ?? row.totalRate,
    "台股每日損益": row["台股每日損益"] ?? row.twPnl,
    "台股每日報酬率": row["台股每日報酬率"] ?? row.twRate,
    "美股每日損益": row["美股每日損益"] ?? row.usPnl,
    "美股每日報酬率": row["美股每日報酬率"] ?? row.usRate,
    "累積報酬率": row["累積報酬率"] ?? row.cumulativeRate,
  })));
}

function normalizeDailyAssetSnapshot(row) {
  const date = parseDate(row["日期"] || row.date);
  if (!date) return null;
  return {
    date,
    netWorth: toNumber(row["淨資產"] ?? row.netWorth),
    tw: toNumber(row["台股市值"] ?? row.tw),
    us: toNumber(row["美股市值"] ?? row.us),
    cash: toNumber(row["流動資金"] ?? row.cash),
    totalPnl: toNumber(row["每日損益"] ?? row.totalPnl),
    totalRate: toRate(row["每日報酬率"] ?? row.totalRate),
    twPnl: toNumber(row["台股每日損益"] ?? row.twPnl),
    twRate: toRate(row["台股每日報酬率"] ?? row.twRate),
    usPnl: toNumber(row["美股每日損益"] ?? row.usPnl),
    usRate: toRate(row["美股每日報酬率"] ?? row.usRate),
  };
}

function normalizeStock(row) {
  const market = row["市場"]?.trim();
  const ticker = row["標的"]?.trim();
  if (!market || !ticker) return null;

  return {
    market,
    ticker,
    name: row["名稱"]?.trim() || ticker,
    cost: toNumber(row["持有成本"]),
    qty: toNumber(row["庫存股數"]),
    price: toNumber(row["股票現價"]),
    value: toNumber(row["目前市值"]),
    todayPnl: toNumber(row["今日損益"]),
    unrealizedPnl: toNumber(row["未實現損益"]),
    unrealizedRate: toRate(row["未實現報酬率"]),
    realizedPnl: toNumber(row["已實現損益(含息)"]),
    realizedRate: toRate(row["已實現報酬率(含息)"]),
    pct: row["股票佔比"] || "0%",
    avgPrice: toNumber(row["成交均價"]),
    breakEven: toNumber(row["損益平衡價"]),
  };
}

function normalizeApiStocks(appData) {
  const stocks = [
    ...(appData?.twStocks || []),
    ...(appData?.usStocks || []),
  ];
  return stocks.map((row) => ({
    market: row.market || "",
    ticker: String(row.ticker || "").trim(),
    name: String(row.name || row.ticker || "").trim(),
    cost: toNumber(row.cost),
    qty: toNumber(row.qty),
    price: toNumber(row.price),
    value: toNumber(row.value),
    todayPnl: toNumber(row.todayPL ?? row.todayPnl),
    unrealizedPnl: toNumber(row.pl ?? row.unrealizedPnl),
    unrealizedRate: toRate(row.roi ?? row.unrealizedRate),
    realizedPnl: toNumber(row.realizedPL ?? row.realizedPnl),
    realizedRate: toRate(row.realizedROI ?? row.realizedRate),
    pct: row.pct || "0%",
    avgPrice: toNumber(row.avgPrice),
    breakEven: toNumber(row.breakEven),
  })).filter((stock) => stock.market && stock.ticker);
}

function normalizeApiOverview(appData) {
  const rows = [];
  const categories = [...(appData?.categories || [])];
  if (appData?.debtCat) categories.push(appData.debtCat);

  categories.forEach((cat) => {
    rows.push({
      "大類別": cat.name || "",
      "子項目": cat.children?.[0]?.name || "",
      "金額 (TWD)": cat.children?.[0]?.value ?? cat.value ?? 0,
      "app顏色": cat.children?.[0]?.color || cat.color || "",
    });
    (cat.children || []).slice(1).forEach((child) => {
      rows.push({
        "大類別": "",
        "子項目": child.name || "",
        "金額 (TWD)": child.value ?? 0,
        "app顏色": child.color || cat.color || "",
      });
    });
  });

  return rows;
}

function normalizeTransaction(row) {
  const ticker = row["標的"]?.trim();
  const type = row["交易類型"]?.trim();
  if (!ticker || !type) return null;

  return {
    formRow: row["表單列數"],
    source: row["來源"] || "",
    ts: row["時間戳記"],
    status: row["狀態"]?.trim() || "",
    date: row["日期"]?.trim() || "",
    market: row["市場"]?.trim() || "",
    ticker,
    type,
    broker: row["券商"]?.trim() || "",
    buyId: row["買入編號"]?.trim() || "",
    sellId: row["賣出編號"]?.trim() || "",
    price: toNumber(row["成交單價"]),
    qty: toNumber(row["股數"]),
    remQty: toNumber(row["剩餘股數"]),
    fee: toNumber(row["手續費／稅金"]),
    stockPrice: toNumber(row["股票現價"]),
    unrealizedPnl: toNumber(row["未實現損益"]),
    unrealizedRate: toRate(row["未實現報酬率"]),
    divPrice: toNumber(row["配息單價"]),
    divQty: toNumber(row["配息股數"]),
    other: toNumber(row["匯費／其他費用"]),
    divAmount: toNumber(row["配息金額"]),
    usd: toNumber(row["美元"]),
    fx: toNumber(row["美元匯率"]),
    net: toNumber(row["淨收支"]),
    realizedPnl: toNumber(row["已實現損益"]),
    remCost: toNumber(row["剩餘成本"]),
    sellRate: toRate(row["