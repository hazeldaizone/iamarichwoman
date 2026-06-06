import {
  downloadBackup,
  exportEncryptedBackup,
  getBackupRecords,
  getMeta,
  importDatasetFile,
  loadLocalDataset,
  maybeAutoBackup,
  reloadFromBootstrap,
  restoreEncryptedBackup,
  saveLocalDataset,
  setMeta,
} from "./local-db.js";
import { recalculateDataset } from "./local-calculator.js";

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
  netWorth: { label: "淨資產", pnlLabel: "股票每日損益", field: "netWorth", pnl: "totalPnl", rate: "totalRate", color: "#d9b46f" },
  tw: { label: "台股", field: "tw", pnl: "twPnl", rate: "twRate", color: "#6fc2a4" },
  us: { label: "美股", field: "us", pnl: "usPnl", rate: "usRate", color: "#6d79ff" },
  cash: { label: "流動資金", pnlLabel: "流動資金收支", field: "cash", pnl: "cashPnl", rate: "cashRate", color: "#f2b33d" },
};

async function initApp() {
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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initApp().catch(showAppError), { once: true });
} else {
  initApp().catch(showAppError);
}

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
  state.transactions = (data.transactions || []).map(normalizeTransaction).filter(Boolean);
  state.trend = normalizeTrend(data.trend || [], state.transactions);
  state.overview = data.overview || [];
  state.stocks = (data.stocks || []).map(normalizeStock).filter(Boolean);
  state.dailyAssetSnapshots = normalizeSnapshotRows((data.dailyAssetSnapshots || []).map(normalizeDailyAssetSnapshot).filter(Boolean), state.transactions);
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

  state.overview = overview;
  state.stocks = stocks.map(normalizeStock).filter(Boolean);
  state.transactions = transactions.map(normalizeTransaction).filter(Boolean);
  state.trend = normalizeTrend(trend, state.transactions);
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

function normalizeTrend(rows, transactions = []) {
  const flowMap = buildInvestmentFlowsByDate(transactions);
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
        cashPnl: toNumber(row["流動資金收支"] ?? row.cashPnl),
        cashRate: toRate(row["流動資金收支率"] ?? row.cashRate),
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
    const flowKey = dateKey(representedTradingDate(row) || row.date);
    const flows = flowMap.get(flowKey) || emptyInvestmentFlow();
    row.twPnl = prev ? row.tw - prev.tw - flows.tw.buy + flows.tw.sell + flows.tw.income : row.twPnl || 0;
    row.twRate = prev ? safeRate(row.twPnl, prev.tw) : row.twRate || 0;
    row.usPnl = prev ? row.us - prev.us - flows.us.buy + flows.us.sell + flows.us.income : row.usPnl || 0;
    row.usRate = prev ? safeRate(row.usPnl, prev.us) : row.usRate || 0;
    row.cashPnl = prev ? row.cash - prev.cash : row.cashPnl || 0;
    row.cashRate = prev ? safeRate(row.cashPnl, prev.cash) : row.cashRate || 0;
    row.totalPnl = row.twPnl + row.usPnl;
    row.totalRate = safeRate(row.totalPnl, prev ? prev.tw + prev.us : row.tw + row.us - row.totalPnl);
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
    "流動資金收支": row["流動資金收支"] ?? row.cashPnl,
    "流動資金收支率": row["流動資金收支率"] ?? row.cashRate,
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
    cashPnl: toNumber(row["流動資金收支"] ?? row.cashPnl),
    cashRate: toRate(row["流動資金收支率"] ?? row.cashRate),
  };
}

function normalizeSnapshotRows(rows, transactions = []) {
  const flowMap = buildInvestmentFlowsByDate(transactions);
  return rows
    .sort((a, b) => a.date - b.date)
    .map((row, index, all) => {
      const prev = all[index - 1];
      const flows = flowMap.get(dateKey(row.date)) || emptyInvestmentFlow();
      const twPnl = prev ? row.tw - prev.tw - flows.tw.buy + flows.tw.sell + flows.tw.income : row.twPnl || 0;
      const usPnl = prev ? row.us - prev.us - flows.us.buy + flows.us.sell + flows.us.income : row.usPnl || 0;
      const cashPnl = prev ? row.cash - prev.cash : row.cashPnl || 0;
      const totalPnl = twPnl + usPnl;
      return {
        ...row,
        rawTotalPnl: row.totalPnl,
        rawTotalRate: row.totalRate,
        rawTwPnl: row.twPnl,
        rawTwRate: row.twRate,
        rawUsPnl: row.usPnl,
        rawUsRate: row.usRate,
        twPnl,
        twRate: prev ? safeRate(twPnl, prev.tw) : row.twRate || 0,
        usPnl,
        usRate: prev ? safeRate(usPnl, prev.us) : row.usRate || 0,
        cashPnl,
        cashRate: prev ? safeRate(cashPnl, prev.cash) : row.cashRate || 0,
        totalPnl,
        totalRate: safeRate(totalPnl, prev ? prev.tw + prev.us : row.tw + row.us - totalPnl),
      };
    });
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
    sellRate: toRate(row["賣出報酬率"]),
    detail: row["損益細項"] || "",
  };
}

function buildInvestmentFlowsByDate(transactions = []) {
  const map = new Map();
  transactions.forEach((tx) => {
    const date = parseDate(tx.date);
    const market = tx.market === "美股" ? "us" : tx.market === "台股" ? "tw" : "";
    if (!date || !market) return;
    const key = dateKey(date);
    const flow = map.get(key) || emptyInvestmentFlow();
    const amount = investmentFlowAmount(tx);
    if (tx.type === "買入") flow[market].buy += amount;
    if (tx.type === "賣出") flow[market].sell += amount;
    if (["配息", "股利"].includes(tx.type)) flow[market].income += amount;
    map.set(key, flow);
  });
  return map;
}

function emptyInvestmentFlow() {
  return {
    tw: { buy: 0, sell: 0, income: 0 },
    us: { buy: 0, sell: 0, income: 0 },
  };
}

function investmentFlowAmount(tx) {
  const net = Math.abs(toNumber(tx.net));
  if (net) return net;
  if (["配息", "股利"].includes(tx.type)) return Math.abs(toNumber(tx.divAmount) || toNumber(tx.divPrice) * toNumber(tx.divQty));
  const fx = tx.market === "美股" ? toNumber(tx.fx) || 1 : 1;
  return Math.abs(toNumber(tx.price) * toNumber(tx.qty) * fx + toNumber(tx.fee) + toNumber(tx.other));
}

function normalizeApiDetail(detail) {
  return {
    lots: (detail?.lots || []).map((lot) => ({
      buyId: String(lot.lotId || lot.buyId || "").trim(),
      date: lot.date || "",
      broker: lot.broker || "",
      price: toNumber(lot.price ?? lot.transPrice),
      qty: toNumber(lot.qty),
      remQty: toNumber(lot.remQty ?? lot.qty),
      remCost: toNumber(lot.cost),
      unrealizedPnl: toNumber(lot.pl ?? lot.unrealizedPnl),
      unrealizedRate: toRate(lot.roi ?? lot.unrealizedRate),
      stockPrice: toNumber(lot.marketPrice),
    })),
    divs: (detail?.divs || []).map((div) => ({
      date: div.date || "",
      broker: div.broker || "",
      divAmount: toNumber(div.amount ?? div.divAmount),
      divQty: toNumber(div.qty ?? div.divQty),
      divPrice: toNumber(div.price ?? div.divPrice),
      other: toNumber(div.fee ?? div.other),
    })),
    realized: (detail?.realized || []).map((sell) => ({
      date: sell.date || "",
      broker: sell.broker || "",
      qty: toNumber(sell.qty),
      price: toNumber(sell.sellPrice ?? sell.price),
      buyPrice: toNumber(sell.buyPrice),
      fee: toNumber(sell.fee),
      realizedPnl: toNumber(sell.pl ?? sell.realizedPnl),
      sellRate: toRate(sell.roi ?? sell.sellRate),
      subLots: (sell.subLots || []).map((lot) => ({
        date: lot.date || "",
        buyPrice: toNumber(lot.buyPrice),
        broker: lot.broker || "",
        qty: toNumber(lot.qty),
      })),
    })),
  };
}

function renderAll() {
  renderOverview();
  renderTrend();
  renderCalendar();
  renderAnalysis();
  renderHoldings();
  renderTradeFields();
}

function renderOverview() {
  const latest = state.trend[state.trend.length - 1];
  if (!latest) return;

  setText("latest-date", formatDate(latest.date));
  setText("net-worth", formatMoney(latest.netWorth));
  const latestPnl = latestMarketPnlRow();
  const changeEl = document.getElementById("net-change");
  if (latestPnl) {
    changeEl.textContent = `最近股票 ${formatSignedMoney(latestPnl.totalPnl)} / ${formatSignedPercent(latestPnl.totalRate)}`;
    setTone(changeEl, latestPnl.totalPnl);
  } else {
    changeEl.textContent = "股票損益資料不足";
    setTone(changeEl, null);
  }

  setText("allocation-total", formatMoney(latest.netWorth));
  renderRetirementProgress(latest);
  renderAllocation(latest);
  renderCategories();
  renderMonthSummary("overview-month-summary", state.calendarDate);
}

function renderRetirementProgress(latest) {
  const goal = state.retirementGoal || 0;
  const ratio = safeRate(latest.netWorth, goal);
  document.getElementById("retirement-panel").innerHTML = `
    <div class="retirement-head">
      <span>退休進度 <strong>${formatPercent(ratio, 2)}</strong></span>
      <button class="retirement-goal" data-edit-retirement type="button">目標 ${formatMoney(goal)}</button>
    </div>
    <div class="retirement-bar" aria-label="退休進度">
      <span style="width:${Math.min(Math.max(ratio * 100, 0), 100)}%"></span>
    </div>
  `;
  bindLongPressTarget("[data-edit-retirement]", () => {
    showAmountEditor({
      title: "修改退休目標",
      amount: goal,
      kind: "retirement",
    });
  });
  bindLongPressElement(document.getElementById("retirement-panel"), () => {
    showAmountEditor({
      title: "修改退休目標",
      amount: goal,
      kind: "retirement",
    });
  });
}

function renderAllocation(latest) {
  const items = allocationSegments(latest);
  const total = items.reduce((sum, item) => sum + Math.max(0, item[1]), 0);
  document.getElementById("allocation-bar").innerHTML = items
    .map(([label, value, color]) => {
      const ratio = safeRate(Math.max(0, value), total);
      return `
        <div class="allocation-segment" style="width:${ratio * 100}%;background:${color}">
          <span>${allocationShortLabel(label)}</span>
          <strong>${formatPercent(ratio, 0)}</strong>
        </div>
      `;
    })
    .join("");
}

function allocationShortLabel(label) {
  return {
    流動資金: "流動",
    固定資產: "固定",
  }[label] || label;
}

function allocationSegments(latest) {
  const groups = buildAssetGroups();
  const segments = [];
  groups.forEach((group) => {
    if (group.name === "投資") {
      segments.push(["台股", latest.tw, "var(--tw)"]);
      segments.push(["美股", latest.us, "var(--us)"]);
      return;
    }
    segments.push([group.name, Math.abs(group.value), group.color]);
  });
  return segments.filter(([, value]) => value > 0);
}

function renderCategories() {
  const latest = state.trend[state.trend.length - 1];
  const netWorth = latest?.netWorth || 0;
  const groups = buildAssetGroups();

  document.getElementById("category-list").innerHTML = groups
    .map((group, index) => `
      <article class="category-group ${group.isEmpty ? "is-empty" : ""}" data-category-index="${index}">
        <button class="category-group-head" type="button" data-toggle-category="${index}">
          <span class="pct-badge" style="background:${group.color}">${formatPercent(safeRate(Math.abs(group.value), netWorth), 2)}</span>
          <span class="category-group-name">${group.name}</span>
          <span class="category-chevron">${group.children.length ? "⌄" : ""}</span>
          <strong class="category-group-value">${group.value < 0 ? "-" : ""}${formatMoney(Math.abs(group.value))}</strong>
        </button>
        <button class="category-add-action" type="button" data-add-asset-child="${index}">新增子項目</button>
        <div class="category-children">
          ${group.children
            .map((child, childIndex) => `
              <div class="category-child ${isComputedInvestmentChild(group.name, child.name) ? "computed" : ""}" ${isComputedInvestmentChild(group.name, child.name) ? "" : `data-edit-asset-child="${index}:${childIndex}"`}>
                <span class="pct-badge child" style="background:${child.color}">${formatPercent(safeRate(Math.abs(child.value), netWorth), 2)}</span>
                <span>${child.name}</span>
                <strong>${child.value < 0 ? "-" : ""}${formatMoney(Math.abs(child.value))}</strong>
              </div>
            `)
            .join("")}
        </div>
      </article>
    `)
    .join("");

  document.querySelectorAll("[data-toggle-category]").forEach((button) => {
    button.addEventListener("click", () => {
      button.closest(".category-group")?.querySelector(".category-children")?.classList.toggle("open");
    });
  });

  document.querySelectorAll("[data-category-index]").forEach((card) => {
    const group = groups[Number(card.dataset.categoryIndex)];
    if (!group) return;
    bindSwipeLeftElement(card, () => showAmountEditor({
      title: `新增 ${group.name} 子項目`,
      amount: 0,
      kind: "asset-add",
      groupName: group.name,
      itemName: "",
      color: normalizeColor(group.color),
    }));
  });

  document.querySelectorAll("[data-add-asset-child]").forEach((button) => {
    const group = groups[Number(button.dataset.addAssetChild)];
    if (!group) return;
    button.addEventListener("click", () => showAmountEditor({
      title: `新增 ${group.name} 子項目`,
      amount: 0,
      kind: "asset-add",
      groupName: group.name,
      itemName: "",
      color: normalizeColor(group.color),
    }));
  });

  document.querySelectorAll("[data-edit-asset-child]").forEach((childEl) => {
    const [groupIndexText, childIndexText] = childEl.dataset.editAssetChild.split(":");
    const group = groups[Number(groupIndexText)];
    const child = group?.children[Number(childIndexText)];
    if (!group || !child) return;
    bindLongPressElement(childEl, () => {
      showAmountEditor({
        title: `修改 ${child.name}`,
        amount: Math.abs(child.value),
        kind: "asset",
        groupName: group.name,
        itemName: child.name,
        color: child.color,
      });
    });
  });
}

function buildAssetGroups() {
  const colors = {
    流動資金: "var(--cash)",
    投資: "var(--tw)",
    應收款: "#b5a2a4",
    固定資產: "#d9695f",
    負債: "var(--debt)",
  };
  const groups = [];
  let current = null;

  state.overview.forEach((row) => {
    const categoryName = row["大類別"]?.trim();
    const childName = row["子項目"]?.trim();
    const value = toNumber(row["金額 (TWD)"]);
    if (categoryName === "總計") return;

    if (categoryName) {
      current = {
        name: categoryName,
        value: 0,
        color: row["app顏色"] || colors[categoryName] || "var(--neutral)",
        children: [],
      };
      groups.push(current);
    }

    if (!current || !childName) return;
    const signedValue = current.name.includes("負債") ? -Math.abs(value) : value;
    current.children.push({
      name: childName,
      value: signedValue,
      color: row["app顏色"] || current.color,
    });
    current.value += signedValue;
  });

  groups.forEach((group) => {
    if (group.children[0]?.color) group.color = group.children[0].color;
    group.isEmpty = Math.abs(group.value) <= 0.00001;
    if (group.isEmpty) group.color = "var(--neutral)";
  });

  return groups.sort((a, b) => Number(a.isEmpty) - Number(b.isEmpty));
}

function renderTrend() {
  const config = TREND_SERIES[state.activeTrendSeries] || TREND_SERIES.netWorth;
  const rows = trendRowsForActiveRange(config);
  setText("trend-chart-title", `${config.label}走勢`);
  setText("trend-chart-range", trendRangeLabel(rows.length));
  renderLineChart(rows, config);

  const latest = state.trend[state.trend.length - 1];
  if (!latest) return;
  const selectedStats = latestPnlStatsForSeries(state.activeTrendSeries);
  const selectedPnl = selectedStats?.pnl || 0;
  const selectedRate = selectedStats?.rate || 0;
  const comparisonMetrics = Object.entries(TREND_SERIES)
    .filter(([key]) => key !== state.activeTrendSeries && key !== "netWorth")
    .map(([key, item]) => {
      const stats = latestPnlStatsForSeries(key);
      return metricCard(item.pnlLabel || `${item.label}每日損益`, stats ? formatSignedMoney(stats.pnl) : "--", stats ? formatSignedPercent(stats.rate) : "資料不足", stats?.pnl ?? null);
    });

  document.getElementById("trend-metrics").innerHTML = [
    metricCard(config.pnlLabel || `${config.label}每日損益`, selectedStats ? formatSignedMoney(selectedPnl) : "--", selectedStats ? formatSignedPercent(selectedRate) : "資料不足", selectedStats ? selectedPnl : null),
    metricCard(`${config.label}目前數值`, formatMoney(latest[config.field]), "最新快照"),
    ...comparisonMetrics.slice(0, 2),
  ].join("");
}

function trendRowsForActiveRange(config) {
  const visibleRows = state.trend.filter((row) => row[config.field] > 0);
  const rows = state.activeTrendRange === "all"
    ? visibleRows
    : visibleRows.slice(-Number(state.activeTrendRange || 30));
  if (state.activeTrendRange === "all") return rows;
  return rows;
}

function trendRangeLabel(count) {
  if (state.activeTrendRange === "all") return `全部 ${count} 筆`;
  return `最近 ${state.activeTrendRange} 天`;
}

function renderLineChart(rows, config = TREND_SERIES.netWorth) {
  const svg = document.getElementById("net-chart");
  if (!rows.length) {
    svg.innerHTML = `<text x="180" y="92" fill="#9b9ba6" font-size="13" font-weight="800" text-anchor="middle">目前沒有${config.label}資料</text>`;
    return;
  }
  const values = rows.map((r) => r[config.field]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 360;
  const height = 180;
  const pad = 18;
  const points = rows.map((row, i) => {
    const x = pad + (i / Math.max(rows.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - safeRate(row[config.field] - min, max - min || 1) * (height - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  svg.innerHTML = `
    <defs>
      <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="${config.color}" stop-opacity="0.32"></stop>
        <stop offset="100%" stop-color="${config.color}" stop-opacity="0"></stop>
      </linearGradient>
    </defs>
    <polyline points="${points.join(" ")} ${width - pad},${height - pad} ${pad},${height - pad}" fill="url(#chartFill)" stroke="none"></polyline>
    <polyline points="${points.join(" ")}" fill="none" stroke="${config.color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
    <text x="${pad}" y="${height - 8}" fill="#9b9ba6" font-size="11" font-weight="700">${formatMoney(min)}</text>
    <text x="${width - pad}" y="${height - 8}" fill="#9b9ba6" font-size="11" font-weight="700" text-anchor="end">${formatMoney(max)}</text>
    <text x="${pad}" y="24" fill="#9b9ba6" font-size="11" font-weight="700">${formatDate(rows[0].date)}</text>
    <text x="${width - pad}" y="24" fill="#9b9ba6" font-size="11" font-weight="700" text-anchor="end">${formatDate(rows[rows.length - 1].date)}</text>
  `;
}

function renderCalendar() {
  const current = state.calendarDate;
  const year = current.getFullYear();
  const month = current.getMonth();
  setText("calendar-title", `${year} 年 ${month + 1} 月`);
  renderMonthSummary("calendar-summary", current);

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const monthRows = calendarRowsInMonth(current);
  const byDate = new Map(monthRows.map((row) => [dateKey(row.date), row]));
  const weekdays = ["一", "二", "三", "四", "五"];
  const cells = weekdays.map((d) => `<div class="weekday">${d}</div>`);

  const firstWeekday = firstDisplayWeekday(first);
  for (let i = 0; i < firstWeekday; i++) cells.push(`<div class="day-cell empty"></div>`);

  for (let day = 1; day <= last.getDate(); day++) {
    const date = new Date(year, month, day);
    if (isWeekend(date)) continue;
    const row = byDate.get(dateKey(date));
    const pnl = row ? getCalendarPnl(row) : 0;
    const rate = row ? getCalendarRate(row) : 0;
    const tone = row ? toneClass(pnl) : "neutral";
    cells.push(`
      <button class="day-cell ${row ? "has-data" : ""}" data-date="${dateKey(date)}" type="button">
        <span class="day-number">${day}</span>
        <span class="day-pnl ${tone}">${row ? formatCalendarMoney(pnl) : "--"}</span>
        <span class="day-rate">${row ? formatSignedPercent(rate) : "休市"}</span>
      </button>
    `);
  }

  document.getElementById("calendar-grid").innerHTML = cells.join("");
  document.querySelectorAll(".day-cell.has-data").forEach((cell) => {
    cell.addEventListener("click", () => showDayDetail(cell.dataset.date));
  });
}

function renderMonthSummary(targetId, monthDate) {
  const rows = calendarRowsInMonth(monthDate);
  const total = rows.reduce((sum, row) => sum + getCalendarPnl(row), 0);
  const profitRows = rows.filter((row) => getCalendarPnl(row) > 0);
  const lossRows = rows.filter((row) => getCalendarPnl(row) < 0);
  const best = profitRows.reduce((pick, row) => (!pick || getCalendarPnl(row) > getCalendarPnl(pick) ? row : pick), null);
  const worst = lossRows.reduce((pick, row) => (!pick || getCalendarPnl(row) < getCalendarPnl(pick) ? row : pick), null);
  const monthlyRate = calcMonthlyCalendarRate(monthDate, total);

  document.getElementById(targetId).innerHTML = [
    summaryPill("本月累積", targetId === "calendar-summary" ? formatCalendarMoney(total) : formatSignedMoney(total), total),
    summaryPill("報酬率", formatSignedPercent(monthlyRate), monthlyRate),
    summaryPill("最大獲利", best ? summaryDateMoney(best.date, getCalendarPnl(best), targetId === "calendar-summary") : summaryDateMoney(null, 0, targetId === "calendar-summary"), best ? getCalendarPnl(best) : 0),
    summaryPill("最大虧損", worst ? summaryDateMoney(worst.date, getCalendarPnl(worst), targetId === "calendar-summary") : summaryDateMoney(null, 0, targetId === "calendar-summary"), worst ? getCalendarPnl(worst) : 0),
  ].join("");
}

function renderAnalysis() {
  const latest = state.trend[state.trend.length - 1];
  const rows = marketPnlRowsInMonth(state.calendarDate);
  const cashRows = cashRowsInMonth(state.calendarDate);
  const monthlyTotal = rows.reduce((sum, row) => sum + row.totalPnl, 0);
  const monthlyTw = rows.reduce((sum, row) => sum + row.twPnl, 0);
  const monthlyUs = rows.reduce((sum, row) => sum + row.usPnl, 0);
  const monthlyCash = cashRows.reduce((sum, row) => sum + row.cashPnl, 0);
  const averageRate = rows.length ? rows.reduce((sum, row) => sum + row.totalRate, 0) / rows.length : 0;

  const analysis = [
    ["本月股票損益", formatSignedMoney(monthlyTotal), monthlyTotal],
    ["台股貢獻", formatSignedMoney(monthlyTw), monthlyTw],
    ["美股貢獻", formatSignedMoney(monthlyUs), monthlyUs],
    ["流動資金收支", formatSignedMoney(monthlyCash), monthlyCash],
    ["平均日報酬率", formatSignedPercent(averageRate), averageRate],
    ["目前淨資產", latest ? formatMoney(latest.netWorth) : "--", null],
  ];

  document.getElementById("analysis-list").innerHTML = analysis
    .map(([label, value, tone]) => `<div class="analysis-row"><span>${label}</span><strong class="${toneClassName(tone)}">${value}</strong></div>`)
    .join("");
}

function renderHoldings() {
  const stocks = state.stocks.filter((s) => s.market === state.activeMarket);
  const active = stocks.filter((s) => s.qty > 0);
  const total = active.reduce(
    (acc, stock) => {
      acc.cost += stock.cost;
      acc.value += stock.value;
      acc.pnl += stock.unrealizedPnl;
      acc.today += stock.todayPnl;
      return acc;
    },
    { cost: 0, value: 0, pnl: 0, today: 0 },
  );

  document.getElementById("holding-summary").innerHTML = `
    <div class="holding-summary-grid">
      ${metricMini("持有成本", formatMoney(total.cost))}
      ${metricMini("目前市值", formatMoney(total.value))}
      ${metricMini("未實現損益（報酬率）", `${formatSignedMoney(total.pnl)} (${formatSignedPercent(safeRate(total.pnl, total.cost))})`, total.pnl)}
      ${metricMini("市場今日損益", `${formatSignedMoney(total.today)} (${formatSignedPercent(safeRate(total.today, total.value - total.today))})`, total.today)}
    </div>
  `;

  document.getElementById("holding-list").innerHTML = active
    .sort((a, b) => b.value - a.value)
    .map((stock) => `
      <article class="holding-card" data-holding-ticker="${stock.ticker}">
        <div class="holding-card-main">
          <div class="holding-name">
            <div class="holding-id-row">
              <span class="pct-badge" style="background:${stock.market === "美股" ? "var(--us)" : "var(--tw)"}">${formatStockPct(stock.pct)}</span>
              <span class="holding-code">${stock.ticker}</span>
            </div>
            <strong>${state.activeMarket === "美股" ? stock.ticker : stock.name}</strong>
            <div class="holding-facts">
              <span>現價 <b>${formatPriceWithUnit(stock.price, stock.market)}</b></span>
              <span>持有 <b>${formatQty(stock.qty)} 股</b></span>
              <span>均價 <b>${formatPriceWithUnit(stock.avgPrice, stock.market)}</b></span>
              <span>損平 <b>${formatPriceWithUnit(stock.breakEven, stock.market)}</b></span>
            </div>
          </div>
          <div class="holding-money">
            <strong class="holding-value">${formatMoney(stock.value)}</strong>
            <div class="holding-return total-return">
              <span>總損益</span>
              <strong class="${toneClass(stock.unrealizedPnl)}">${formatSignedMoney(stock.unrealizedPnl)}</strong>
              <small class="${toneClass(stock.unrealizedRate)}">${formatSignedPercent(stock.unrealizedRate)}</small>
            </div>
            <div class="holding-return today-return">
              <span>今日</span>
              <strong class="${toneClass(stock.todayPnl)}">${formatSignedMoney(stock.todayPnl)}</strong>
              <small class="${toneClass(stock.todayPnl)}">${formatSignedPercent(safeRate(stock.todayPnl, stock.value - stock.todayPnl))}</small>
            </div>
          </div>
        </div>
      </article>
    `)
    .join("");

  document.querySelectorAll("[data-holding-ticker]").forEach((card) => {
    card.addEventListener("click", () => showHoldingDetail(card.dataset.holdingTicker));
  });
}

async function showHoldingDetail(ticker) {
  const stock = state.stocks.find((item) => item.ticker === ticker && item.market === state.activeMarket)
    || state.stocks.find((item) => item.ticker === ticker);
  if (!stock) return;

  state.detailTab = "lots";
  const dialog = document.getElementById("holding-dialog");
  renderHoldingDetail(stock, getLocalHoldingDetail(stock));
  dialog.showModal();

  if (hasRemoteApi()) {
    try {
      const detail = await loadTickerDetail(stock.ticker);
      renderHoldingDetail(stock, detail);
    } catch (err) {
      console.warn(`讀取 ${stock.ticker} 詳情失敗：`, err);
    }
  }
}

function getLocalHoldingDetail(stock) {
  const tx = state.transactions.filter((item) => item.ticker === stock.ticker);
  const lots = tx.filter((item) => ["未實現", "部分實現", "結轉"].some((s) => item.status.includes(s)) && item.remQty > 0);
  const divs = tx.filter((item) => item.type === "配息");
  const realized = tx.filter((item) => item.type === "賣出").map((sell) => {
    const subLots = parseSellSubLots(sell, tx);
    const totalQty = subLots.reduce((sum, lot) => sum + lot.qty, 0);
    const totalBuy = subLots.reduce((sum, lot) => sum + lot.qty * lot.buyPrice, 0);
    return {
      ...sell,
      buyPrice: totalQty ? totalBuy / totalQty : 0,
      subLots,
    };
  });
  return { lots, divs, realized };
}

async function loadTickerDetail(ticker) {
  if (state.remoteDetailCache.has(ticker)) return state.remoteDetailCache.get(ticker);
  const detail = normalizeApiDetail(await apiRun("getTickerDetail", { ticker }));
  state.remoteDetailCache.set(ticker, detail);
  return detail;
}

function renderHoldingDetail(stock, detail = getLocalHoldingDetail(stock)) {
  const { lots, divs, realized } = detail;
  const rows = { lots, divs, realized }[state.detailTab];

  document.getElementById("holding-detail").innerHTML = `
    <div class="detail-header">
      <span class="holding-meta">${stock.market} / ${stock.ticker}</span>
      <h2>${stock.market === "美股" ? stock.ticker : stock.name}</h2>
      ${renderDetailSummaryCard(stock, detail)}
      <div class="detail-tabs">
        ${detailTabButton("lots", "庫存", lots.length)}
        ${detailTabButton("divs", "股利", divs.length)}
        ${detailTabButton("realized", "已實現", realized.length)}
      </div>
    </div>
    <div class="detail-content">${renderHoldingDetailTab(stock, rows)}</div>
  `;

  document.querySelectorAll("[data-detail-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.detailTab = button.dataset.detailTab;
      renderHoldingDetail(stock, detail);
    });
  });

  if (state.detailTab === "lots") bindLongPressSell(stock, lots);
}

function detailTabButton(id, label, count) {
  return `<button class="detail-tab ${state.detailTab === id ? "active" : ""}" data-detail-tab="${id}" type="button">${label}<span>${count}</span></button>`;
}

function renderDetailSummaryCard(stock, detail) {
  const { lots, divs, realized } = detail;
  if (state.detailTab === "divs") {
    const totalDiv = divs.reduce((sum, item) => sum + item.divAmount, 0);
    const totalQty = divs.reduce((sum, item) => sum + item.divQty, 0);
    const latest = latestByDate(divs);
    return `
      <div class="detail-summary-card">
        ${metricMini("累計總股利", formatMoney(totalDiv), totalDiv)}
        ${metricMini("股利筆數", `${divs.length} 筆`)}
        ${metricMini("累計配息股數", `${formatQty(totalQty)} 股`)}
        ${metricMini("最近配息", latest?.date || "--")}
      </div>
    `;
  }

  if (state.detailTab === "realized") {
    const totalPnl = realized.reduce((sum, item) => sum + item.realizedPnl, 0);
    const totalQty = realized.reduce((sum, item) => sum + item.qty, 0);
    const averageRate = realized.length ? realized.reduce((sum, item) => sum + item.sellRate, 0) / realized.length : 0;
    return `
      <div class="detail-summary-card">
        ${metricMini("已實現損益", formatSignedMoney(totalPnl), totalPnl)}
        ${metricMini("平均報酬率", formatSignedPercent(averageRate), averageRate)}
        ${metricMini("賣出筆數", `${realized.length} 筆`)}
        ${metricMini("累計賣出股數", `${formatQty(totalQty)} 股`)}
      </div>
    `;
  }

  return `
    <div class="detail-summary-card">
      ${metricMini("持有成本", formatMoney(stock.cost))}
      ${metricMini("目前市值", formatMoney(stock.value))}
      ${metricMini("庫存股數", `${formatQty(stock.qty)} 股`)}
      ${metricMini("股票現價", formatPriceWithUnit(stock.price, stock.market))}
      ${metricMini("未實現損益", formatSignedMoney(stock.unrealizedPnl), stock.unrealizedPnl)}
      ${metricMini("報酬率", formatSignedPercent(stock.unrealizedRate), stock.unrealizedRate)}
    </div>
  `;
}

function renderHoldingDetailTab(stock, rows) {
  if (!rows.length) return `<div class="empty-state">目前沒有資料</div>`;

  if (state.detailTab === "lots") {
    return `
      ${rows
      .map((lot) => `
        <article class="detail-card pressable" data-lot-id="${escapeHtml(lot.buyId || "")}">
          <div class="detail-card-top">
            <strong class="${toneClass(lot.unrealizedPnl)}">${formatMoney(Math.abs(lot.unrealizedPnl))}</strong>
            <strong class="${toneClass(lot.unrealizedRate)}">${formatPercentPlain(lot.unrealizedRate)}</strong>
            <span class="broker-name">${escapeHtml(lot.broker || "--")}</span>
          </div>
          <div class="detail-grid compact">
            ${metricMini("股數", `${formatQty(lot.remQty || lot.qty)} 股`)}
            ${metricMini("成本", formatMoney(Math.abs(lot.remCost)))}
            ${metricMini("成交單價", formatPriceWithUnit(lot.price, stock.market))}
            ${metricMini("日期", lot.date || "--")}
          </div>
        </article>
      `)
      .join("")}
    `;
  }

  if (state.detailTab === "divs") {
    return rows
      .map((div) => `
        <article class="detail-card dividend-card">
          <div class="dividend-head">
            <strong class="dividend-amount profit">${formatMoney(div.divAmount)}</strong>
            <span>${escapeHtml(div.date || "--")}</span>
          </div>
          <div class="detail-grid compact dividend-grid">
            ${metricMini("股數", `${formatQty(div.divQty)} 股`)}
            ${metricMini(stock.market === "美股" ? "稅金" : "匯費", formatMoney(div.other))}
            ${metricMini("單價", formatPriceWithUnit(div.divPrice, stock.market))}
            <div><span class="metric-label">券商</span><strong class="metric-value broker-value">${escapeHtml(div.broker || "--")}</strong></div>
          </div>
        </article>
      `)
      .join("");
  }

  return rows
    .map((sell) => `
      <article class="detail-card realized-card">
        <div class="realized-head">
          <strong class="${toneClass(sell.realizedPnl)}">${formatMoney(Math.abs(sell.realizedPnl))}</strong>
          <strong class="${toneClass(sell.sellRate)}">${formatPercentPlain(sell.sellRate)}</strong>
          <span>${escapeHtml(sell.date || "--")}</span>
        </div>
        <div class="detail-grid compact">
          ${metricMini("股數", `${formatQty(sell.qty)} 股`)}
          ${metricMini("手續費", formatMoney(sell.fee))}
          ${metricMini("平均買入", formatPriceWithUnit(sell.buyPrice, stock.market))}
          ${metricMini("賣出價", formatPriceWithUnit(sell.price, stock.market))}
        </div>
        ${renderRealizedSubLots(sell, stock)}
      </article>
    `)
    .join("");
}

function parseSellSubLots(sell, transactions) {
  return String(sell.sellId || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [id, qtyText] = part.split(":");
      const buy = transactions.find((item) => item.buyId === id);
      return {
        id,
        date: buy?.date || "",
        buyPrice: buy?.price || 0,
        broker: buy?.broker || "",
        qty: toNumber(qtyText) || buy?.qty || 0,
      };
    });
}

function renderRealizedSubLots(sell, stock) {
  if (!sell.subLots?.length || sell.subLots.length <= 1) return "";
  return `
    <details class="sell-detail">
      <summary>賣出明細 ${sell.subLots.length} 筆</summary>
      <div class="sell-detail-list">
        ${sell.subLots.map((lot) => `
          <div class="sell-detail-row">
            <span>${escapeHtml(lot.date || "--")} 買入 ${formatPriceWithUnit(lot.buyPrice, stock.market)}</span>
            <span>${formatQty(lot.qty)} 股</span>
            <span>${escapeHtml(lot.broker || "--")}</span>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function bindNavigation() {
  document.querySelectorAll("[data-screen], [data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.screen || (button.dataset.nav === "calendar" ? "trends" : button.dataset.nav);
      switchScreen(target);
      if (button.dataset.nav === "calendar") switchTrendView("calendar");
    });
  });
}

function switchScreen(screen) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.toggle("active", el.id === `screen-${screen}`));
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.screen === screen));
  setText("page-title", pageTitles[screen] || "總覽");
}

function bindTrendTabs() {
  document.querySelectorAll("[data-trend-view]").forEach((button) => {
    button.addEventListener("click", () => switchTrendView(button.dataset.trendView));
  });
}

function bindTrendControls() {
  document.querySelectorAll("[data-trend-range]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTrendRange = button.dataset.trendRange;
      document.querySelectorAll("[data-trend-range]").forEach((el) => el.classList.toggle("active", el === button));
      renderTrend();
    });
  });

  document.querySelectorAll("[data-trend-series]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTrendSeries = button.dataset.trendSeries;
      document.querySelectorAll("[data-trend-series]").forEach((el) => el.classList.toggle("active", el === button));
      renderTrend();
    });
  });
}

function switchTrendView(view) {
  document.querySelectorAll("[data-trend-view]").forEach((el) => el.classList.toggle("active", el.dataset.trendView === view));
  document.querySelectorAll(".trend-view").forEach((el) => el.classList.toggle("active", el.id === `trend-${view}`));
}

function bindCalendarControls() {
  document.getElementById("prev-month").addEventListener("click", () => shiftMonth(-1));
  document.getElementById("next-month").addEventListener("click", () => shiftMonth(1));
  document.querySelectorAll("[data-calendar-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.calendarMode = button.dataset.calendarMode;
      document.querySelectorAll("[data-calendar-mode]").forEach((el) => el.classList.toggle("active", el === button));
      renderCalendar();
    });
  });
}

function shiftMonth(amount) {
  state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + amount, 1);
  renderCalendar();
  renderAnalysis();
}

function bindMarketTabs() {
  document.querySelectorAll("[data-market]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeMarket = button.dataset.market;
      document.querySelectorAll("[data-market]").forEach((el) => el.classList.toggle("active", el === button));
      renderHoldings();
    });
  });
}

function bindTradeForm() {
  document.getElementById("trade-type").addEventListener("change", renderTradeFields);
  document.getElementById("trade-market").addEventListener("change", renderTradeFields);
  document.getElementById("trade-ticker").addEventListener("input", renderSellLotSelector);
  document.getElementById("trade-form").addEventListener("submit", handleTradeSubmit);
  document.getElementById("trade-cancel").addEventListener("click", cancelSellTrade);
}

function bindAssetEditForm() {
  document.getElementById("asset-edit-form").addEventListener("submit", handleAssetEditSubmit);
}

function renderTradeFields() {
  const type = document.getElementById("trade-type").value;
  const today = new Date();
  const dateInput = document.getElementById("trade-date");
  if (!dateInput.value) dateInput.value = dateKey(today);

  const fields = document.getElementById("trade-dynamic-fields");
  if (type === "買入" || type === "賣出") {
    fields.innerHTML = `
      <div class="form-row">
        <label>成交單價<input id="trade-price" type="number" inputmode="decimal" step="0.0001"></label>
        <label>股數<input id="trade-qty" type="number" inputmode="decimal" step="0.00001"></label>
      </div>
      <div class="form-row">
        <label>手續費／稅金<input id="trade-fee" type="number" inputmode="decimal" step="0.01" placeholder="可自動估算"></label>
        <label>手續費折扣<input id="trade-discount" type="number" inputmode="decimal" step="0.1" placeholder="2折輸入2"></label>
      </div>
      <div class="fee-preview hidden" id="trade-fee-preview"></div>
      <input id="trade-sell-id" type="hidden">
    `;
  } else if (type === "配息") {
    fields.innerHTML = `
      <div class="form-row">
        <label>配息單價<input id="trade-div-price" type="number" inputmode="decimal" step="0.0001"></label>
        <label>配息股數<input id="trade-div-qty" type="number" inputmode="decimal" step="0.00001"></label>
      </div>
      <label>匯費／稅金<input id="trade-other" type="number" inputmode="decimal" step="0.01"></label>
    `;
  } else {
    fields.innerHTML = `
      <div class="form-row">
        <label>分割比例<input id="trade-split-ratio" type="number" inputmode="decimal" step="0.0001" placeholder="例如 2"></label>
        <label>分割當天股價<input id="trade-split-price" type="number" inputmode="decimal" step="0.01"></label>
      </div>
    `;
  }

  renderSellLotSelector();
  bindTradeFeeInputs();
  updateTradeFeeEstimate();
  document.getElementById("trade-cancel").classList.toggle("hidden", type !== "賣出");
  document.getElementById("trade-submit").disabled = false;
}

function bindTradeFeeInputs() {
  ["trade-price", "trade-qty", "trade-discount", "trade-market", "trade-type"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", updateTradeFeeEstimate);
    document.getElementById(id)?.addEventListener("change", updateTradeFeeEstimate);
  });
}

function updateTradeFeeEstimate() {
  const feeInput = document.getElementById("trade-fee");
  const preview = document.getElementById("trade-fee-preview");
  if (!feeInput || !preview) return;
  const type = document.getElementById("trade-type").value;
  const market = document.getElementById("trade-market").value;
  const price = toNumber(document.getElementById("trade-price")?.value);
  const qty = toNumber(document.getElementById("trade-qty")?.value);
  const discount = toNumber(document.getElementById("trade-discount")?.value);
  const fee = estimateTradeFee({ market, type, price, qty, discount });
  if (!price || !qty || fee === null) {
    preview.classList.add("hidden");
    preview.textContent = "";
    return;
  }
  feeInput.value = String(fee);
  preview.classList.remove("hidden");
  preview.textContent = market === "台股"
    ? `台股手續費/證交稅估算：${formatMoney(fee)}`
    : `美股依目前試算表規則預設 ${formatPrice(fee)} USD，可手動覆蓋`;
}

function estimateTradeFee({ market, type, price, qty, discount }) {
  if (!["買入", "賣出"].includes(type) || !(price > 0) || !(qty > 0)) return null;
  const amount = price * qty;
  if (market === "台股") {
    const rule = { defaultDiscount: 2, minFee: 1 };
    const d = discount || rule.defaultDiscount;
    let fee = Math.round(amount * 0.001425 * (d / 10));
    if (fee < rule.minFee) fee = rule.minFee;
    if (type === "賣出") fee += Math.round(amount * 0.003);
    return fee;
  }
  return 0;
}

function renderSellLotSelector() {
  const type = document.getElementById("trade-type").value;
  const ticker = document.getElementById("trade-ticker").value.trim().replace(/^'/, "");
  const wrap = document.getElementById("trade-lot-selector");
  if (type !== "賣出" || !ticker) {
    wrap.classList.add("hidden");
    wrap.innerHTML = "";
    return;
  }

  const lots = state.transactions.filter((item) => item.ticker === ticker && ["未實現", "部分實現", "結轉"].some((s) => item.status.includes(s)) && item.remQty > 0);
  wrap.classList.remove("hidden");
  wrap.innerHTML = `
    <div class="lot-selector-head">
      <div class="lot-selector-title">選擇賣出批次</div>
      <button class="lot-selector-close" id="trade-sell-close" type="button" aria-label="關閉賣出">×</button>
    </div>
    ${lots.length ? lots.map(renderTradeLot).join("") : `<div class="empty-state">查無可賣庫存</div>`}
  `;
  document.getElementById("trade-sell-close")?.addEventListener("click", cancelSellTrade);

  wrap.querySelectorAll("[data-trade-lot]").forEach((checkbox) => {
    checkbox.addEventListener("change", updateSelectedSellLots);
  });
  wrap.querySelectorAll("[data-trade-lot-qty]").forEach((input) => {
    input.addEventListener("input", updateSelectedSellLots);
  });
}

function renderTradeLot(lot) {
  return `
    <div class="trade-lot" data-trade-lot-row="${escapeHtml(lot.buyId)}">
      <input type="checkbox" data-trade-lot="${escapeHtml(lot.buyId)}" data-max="${lot.remQty}" aria-label="選擇 ${escapeHtml(lot.date || "")} 庫存">
      <div class="trade-lot-info">
        <strong>${escapeHtml(lot.date || "--")} ${escapeHtml(lot.broker || "")}</strong>
        <small>${formatPriceWithUnit(lot.price, lot.market)} / 剩 ${formatQty(lot.remQty)} 股</small>
      </div>
      <div class="trade-lot-qty">
        <input data-trade-lot-qty="${escapeHtml(lot.buyId)}" type="number" inputmode="decimal" step="0.00001" min="0" max="${lot.remQty}" value="${lot.remQty}">
        <small class="trade-lot-error" data-trade-lot-error="${escapeHtml(lot.buyId)}"></small>
      </div>
    </div>
  `;
}

function updateSelectedSellLots() {
  const selected = [];
  let qty = 0;
  let hasInvalid = false;
  document.querySelectorAll("[data-trade-lot]:checked").forEach((checkbox) => {
    const id = checkbox.dataset.tradeLot;
    const max = Number(checkbox.dataset.max) || 0;
    const qInput = document.querySelector(`[data-trade-lot-qty="${cssEscape(id)}"]`);
    const q = toNumber(qInput?.value);
    const row = checkbox.closest(".trade-lot");
    const error = document.querySelector(`[data-trade-lot-error="${cssEscape(id)}"]`);
    const invalid = q <= 0 || q > max;
    hasInvalid = hasInvalid || invalid;
    row?.classList.toggle("invalid", invalid);
    qInput?.classList.toggle("invalid", invalid);
    if (error) error.textContent = invalid ? `最多可賣 ${formatQty(max)} 股` : "";
    if (!invalid) {
      selected.push(q === max ? id : `${id}:${q}`);
      qty += q;
    }
  });

  document.querySelectorAll("[data-trade-lot]:not(:checked)").forEach((checkbox) => {
    const id = checkbox.dataset.tradeLot;
    checkbox.closest(".trade-lot")?.classList.remove("invalid");
    document.querySelector(`[data-trade-lot-qty="${cssEscape(id)}"]`)?.classList.remove("invalid");
    const error = document.querySelector(`[data-trade-lot-error="${cssEscape(id)}"]`);
    if (error) error.textContent = "";
  });

  const sellId = document.getElementById("trade-sell-id");
  const qtyInput = document.getElementById("trade-qty");
  const submit = document.getElementById("trade-submit");
  if (sellId) sellId.value = selected.join(",");
  if (qtyInput) qtyInput.value = qty ? String(qty) : "";
  if (submit) submit.disabled = hasInvalid;
  return !hasInvalid;
}

function startQuickSell(stock, lot) {
  document.getElementById("holding-dialog").close();
  switchScreen("trade");
  document.getElementById("trade-type").value = "賣出";
  document.getElementById("trade-market").value = stock.market;
  document.getElementById("trade-ticker").value = stock.ticker;
  renderTradeFields();
  const checkbox = document.querySelector(`[data-trade-lot="${cssEscape(lot.buyId)}"]`);
  if (checkbox) {
    checkbox.checked = true;
    updateSelectedSellLots();
  }
}

function cancelSellTrade() {
  document.getElementById("trade-type").value = "買入";
  document.getElementById("trade-ticker").value = "";
  document.getElementById("trade-result").classList.add("hidden");
  renderTradeFields();
  switchScreen("holdings");
}

function bindLongPressSell(stock, lots) {
  document.querySelectorAll("[data-lot-id]").forEach((card) => {
    const lot = lots.find((item) => item.buyId === card.dataset.lotId);
    if (!lot) return;
    bindLongPressElement(card, () => startQuickSell(stock, lot));
  });
}

function bindLongPressTarget(selector, callback) {
  document.querySelectorAll(selector).forEach((el) => bindLongPressElement(el, callback));
}

function bindLongPressElement(el, callback) {
  if (!el) return;
  let timer = null;
  const clearPress = () => {
    window.clearTimeout(timer);
    timer = null;
    el.classList.remove("pressing");
  };

  el.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    el.classList.add("pressing");
    timer = window.setTimeout(() => {
      clearPress();
      callback();
    }, 650);
  });
  el.addEventListener("pointerup", clearPress);
  el.addEventListener("pointerleave", clearPress);
  el.addEventListener("pointercancel", clearPress);
}

function bindSwipeLeftElement(el, callback) {
  if (!el) return;
  let startX = 0;
  let startY = 0;
  let triggered = false;
  el.addEventListener("pointerdown", (event) => {
    startX = event.clientX;
    startY = event.clientY;
    triggered = false;
  });
  el.addEventListener("pointermove", (event) => {
    if (triggered || !startX) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (dx < -70 && Math.abs(dy) < 35) {
      triggered = true;
      el.classList.add("swiped");
      window.setTimeout(() => el.classList.remove("swiped"), 550);
      callback();
    }
  });
  el.addEventListener("pointerup", () => {
    startX = 0;
    startY = 0;
  });
  el.addEventListener("pointercancel", () => {
    startX = 0;
    startY = 0;
  });
}

function showAmountEditor(edit) {
  state.pendingAssetEdit = edit;
  const dialog = document.getElementById("asset-edit-dialog");
  const input = document.getElementById("asset-edit-amount");
  const nameInput = document.getElementById("asset-edit-name");
  const colorInput = document.getElementById("asset-edit-color");
  const nameWrap = document.getElementById("asset-edit-name-wrap");
  const colorWrap = document.getElementById("asset-edit-color-wrap");
  const deleteButton = document.getElementById("asset-delete-button");
  const result = document.getElementById("asset-edit-result");
  setText("asset-edit-title", edit.title);
  input.value = Math.round(edit.amount || 0);
  input.placeholder = String(Math.round(edit.amount || 0));
  nameInput.value = edit.itemName || "";
  colorInput.value = normalizeColor(edit.color);
  nameWrap.classList.toggle("hidden", edit.kind === "retirement");
  colorWrap.classList.toggle("hidden", edit.kind === "retirement");
  deleteButton.classList.toggle("hidden", edit.kind !== "asset");
  deleteButton.onclick = () => handleAssetDelete();
  result.classList.add("hidden");
  result.innerHTML = "";
  dialog.showModal();
  const focusTarget = edit.kind === "asset-add" ? nameInput : input;
  focusTarget.focus();
  focusTarget.select();
}

async function handleAssetEditSubmit(event) {
  event.preventDefault();
  const edit = state.pendingAssetEdit;
  const result = document.getElementById("asset-edit-result");
  const amount = toNumber(document.getElementById("asset-edit-amount").value);
  const nextName = document.getElementById("asset-edit-name").value.trim();
  const nextColor = document.getElementById("asset-edit-color").value;
  if (!edit || amount < 0) return;
  if ((edit.kind === "asset" || edit.kind === "asset-add") && !nextName) {
    result.classList.remove("hidden");
    result.innerHTML = `<strong class="loss">請輸入項目名稱</strong>`;
    return;
  }

  result.classList.remove("hidden");
  if (edit.kind === "retirement") {
    state.retirementGoal = amount;
    localStorage.setItem("retirementGoal", String(amount));
    upsertRetirementGoal(amount);
  } else if (edit.kind === "asset-add") {
    addLocalAssetItem(edit.groupName, nextName, amount, nextColor);
  } else {
    updateLocalAssetItem(edit.groupName, edit.itemName, {
      name: nextName,
      amount,
      color: nextColor,
    });
  }
  await persistLocalState();
  renderOverview();
  result.innerHTML = `<strong class="profit">已寫入本地資料庫</strong>`;
  window.setTimeout(() => document.getElementById("asset-edit-dialog").close(), 450);
}

async function handleAssetDelete() {
  const edit = state.pendingAssetEdit;
  const result = document.getElementById("asset-edit-result");
  if (!edit || edit.kind !== "asset") return;
  if (!window.confirm(`確定刪除「${edit.itemName}」？`)) return;
  deleteLocalAssetItem(edit.groupName, edit.itemName);
  await persistLocalState();
  renderOverview();
  result.classList.remove("hidden");
  result.innerHTML = `<strong class="profit">已刪除項目</strong>`;
  window.setTimeout(() => document.getElementById("asset-edit-dialog").close(), 450);
}

function updateLocalAssetItem(groupName, itemName, patch) {
  let currentGroup = "";
  state.overview = state.overview.map((row) => {
    const rowGroup = row["大類別"]?.trim();
    if (rowGroup) currentGroup = rowGroup;
    if (currentGroup === groupName && row["子項目"]?.trim() === itemName) {
      return {
        ...row,
        "子項目": patch.name,
        "金額 (TWD)": patch.amount,
        "app顏色": patch.color,
      };
    }
    return row;
  });
  syncCategoryColorFromFirstChild(groupName);
}

function addLocalAssetItem(groupName, itemName, amount, color) {
  const rows = [...state.overview];
  let currentGroup = "";
  let insertAt = rows.length;
  for (let i = 0; i < rows.length; i += 1) {
    const rowGroup = rows[i]["大類別"]?.trim();
    if (rowGroup) currentGroup = rowGroup;
    if (rows[i]["大類別"]?.trim() === "總計") {
      insertAt = Math.min(insertAt, i);
      break;
    }
    if (currentGroup === groupName) insertAt = i + 1;
  }
  const groupExists = rows.some((row) => row["大類別"]?.trim() === groupName);
  const newRow = {
    "大類別": groupExists ? "" : groupName,
    "子項目": itemName,
    "金額 (TWD)": amount,
    "佔比 (%)": 0,
    "成本": "",
    "備註": "",
    "app顏色": color,
  };
  rows.splice(insertAt, 0, newRow);
  state.overview = rows;
  syncCategoryColorFromFirstChild(groupName);
}

function deleteLocalAssetItem(groupName, itemName) {
  let currentGroup = "";
  state.overview = state.overview.filter((row) => {
    const rowGroup = row["大類別"]?.trim();
    if (rowGroup) currentGroup = rowGroup;
    return !(currentGroup === groupName && row["子項目"]?.trim() === itemName);
  });
  syncCategoryColorFromFirstChild(groupName);
}

function syncCategoryColorFromFirstChild(groupName) {
  let currentGroup = "";
  let firstColor = "";
  state.overview.forEach((row) => {
    const rowGroup = row["大類別"]?.trim();
    if (rowGroup) currentGroup = rowGroup;
    if (currentGroup === groupName && !firstColor && row["子項目"]?.trim()) {
      firstColor = row["app顏色"] || "";
    }
  });
  if (!firstColor) return;
  currentGroup = "";
  state.overview = state.overview.map((row) => {
    const rowGroup = row["大類別"]?.trim();
    if (rowGroup) currentGroup = rowGroup;
    if (rowGroup === groupName) return { ...row, "app顏色": firstColor };
    return row;
  });
}

function upsertRetirementGoal(amount) {
  const rows = state.dataset?.data?.retirement || [];
  const existing = rows.find((row) => row["項目"] === "退休目標");
  if (existing) {
    existing["數值"] = amount;
  } else {
    rows.unshift({ "項目": "退休目標", "數值": amount, "說明": "PWA 本地設定" });
  }
  if (state.dataset?.data) state.dataset.data.retirement = rows;
}

async function persistLocalState() {
  const dataset = state.dataset || { schemaVersion: 1, source: "local", data: {} };
  dataset.exportedAt = new Date().toISOString();
  dataset.data = {
    ...(dataset.data || {}),
    trend: serializeTrendRows(state.trend),
    overview: state.overview,
    stocks: state.stocks.map(stockToSheetRow),
    transactions: state.transactions.map(transactionToSheetRow),
    retirement: dataset.data?.retirement || [],
    dailyHoldings: dataset.data?.dailyHoldings || [],
    dailyPrices: dataset.data?.dailyPrices || [],
    dailyAssetSnapshots: dataset.data?.dailyAssetSnapshots || [],
  };
  state.dataset = await saveLocalDataset(recalculateDataset(dataset));
  applyDataset(state.dataset);
}

function serializeTrendRows(rows) {
  return rows.map((row) => ({
    "日期": dateKey(row.date),
    "快照時間": row.snapshotTime,
    "淨資產": row.netWorth,
    "台股": row.tw,
    "美股": row.us,
    "流動資金": row.cash,
    "每日損益": row.totalPnl,
    "每日報酬率": row.totalRate,
    "台股每日損益": row.twPnl,
    "台股每日報酬率": row.twRate,
    "美股每日損益": row.usPnl,
    "美股每日報酬率": row.usRate,
    "流動資金收支": row.cashPnl,
    "流動資金收支率": row.cashRate,
    "累積報酬率": row.cumulativeRate,
  }));
}

function stockToSheetRow(stock) {
  return {
    "市場": stock.market,
    "標的": stock.ticker,
    "名稱": stock.name,
    "持有成本": stock.cost,
    "庫存股數": stock.qty,
    "股票現價": stock.price,
    "目前市值": stock.value,
    "今日損益": stock.todayPnl,
    "成交均價": stock.avgPrice,
    "損益平衡價": stock.breakEven,
    "未實現損益": stock.unrealizedPnl,
    "未實現報酬率": stock.unrealizedRate,
    "已實現損益(含息)": stock.realizedPnl,
    "已實現報酬率(含息)": stock.realizedRate,
    "股票佔比": stock.pct,
  };
}

function transactionToSheetRow(tx) {
  return {
    "表單列數": tx.formRow,
    "來源": tx.source,
    "時間戳記": tx.ts,
    "狀態": tx.status,
    "日期": tx.date,
    "市場": tx.market,
    "標的": tx.ticker,
    "交易類型": tx.type,
    "券商": tx.broker,
    "買入編號": tx.buyId,
    "賣出編號": tx.sellId,
    "成交單價": tx.price,
    "股數": tx.qty,
    "剩餘股數": tx.remQty,
    "手續費／稅金": tx.fee,
    "股票現價": tx.stockPrice,
    "未實現損益": tx.unrealizedPnl,
    "未實現報酬率": tx.unrealizedRate,
    "配息單價": tx.divPrice,
    "配息股數": tx.divQty,
    "匯費／其他費用": tx.other,
    "配息金額": tx.divAmount,
    "美元": tx.usd,
    "美元匯率": tx.fx,
    "淨收支": tx.net,
    "已實現損益": tx.realizedPnl,
    "剩餘成本": tx.remCost,
    "賣出報酬率": tx.sellRate,
    "損益細項": tx.detail,
  };
}

function appendLocalTransaction(payload) {
  const tx = localTransactionFromPayload(payload);
  state.transactions.unshift(tx);
  if (payload.type === "賣出") applyLocalSellToLots(tx);
}

function localTransactionFromPayload(payload) {
  const qty = toNumber(payload.qty || payload.divQ);
  const price = toNumber(payload.price || payload.divP);
  const fee = toNumber(payload.fee || payload.other);
  const type = payload.type;
  const buyId = type === "買入" ? buildLocalBuyId(payload.date, payload.ticker) : "";
  return {
    formRow: `local-${Date.now()}`,
    source: "PWA",
    ts: new Date().toISOString(),
    status: type === "買入" ? "未實現" : type,
    date: payload.date,
    market: payload.market,
    ticker: payload.ticker,
    type,
    broker: "",
    buyId,
    sellId: payload.sellId || "",
    price,
    qty,
    remQty: type === "買入" ? qty : 0,
    fee,
    stockPrice: price,
    unrealizedPnl: 0,
    unrealizedRate: 0,
    divPrice: toNumber(payload.divP),
    divQty: toNumber(payload.divQ),
    other: toNumber(payload.other),
    divAmount: type === "配息" ? toNumber(payload.divP) * toNumber(payload.divQ) - toNumber(payload.other) : 0,
    usd: 0,
    fx: 0,
    net: type === "賣出" ? price * qty - fee : -(price * qty + fee),
    realizedPnl: 0,
    remCost: type === "買入" ? price * qty + fee : 0,
    sellRate: 0,
    detail: "",
  };
}

function applyLocalSellToLots(sellTx) {
  let totalCostRemoved = 0;
  String(sellTx.sellId || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const [id, qtyText] = item.split(":");
      const lot = state.transactions.find((tx) => tx.buyId === id);
      if (!lot) return;
      const beforeQty = toNumber(lot.remQty);
      const beforeCost = Math.abs(toNumber(lot.remCost));
      const qty = qtyText ? toNumber(qtyText) : beforeQty;
      const costRemoved = beforeQty ? beforeCost * Math.min(qty, beforeQty) / beforeQty : 0;
      totalCostRemoved += costRemoved;
      lot.remQty = Math.max(0, beforeQty - qty);
      lot.remCost = lot.remQty > 0 ? -Math.round(Math.max(0, beforeCost - costRemoved)) : "";
      lot.status = lot.remQty > 0 ? "部分實現" : "已實現";
    });
  sellTx.realizedPnl = Math.round(toNumber(sellTx.net) - totalCostRemoved);
  sellTx.sellRate = totalCostRemoved ? sellTx.realizedPnl / totalCostRemoved : 0;
}

function buildLocalBuyId(date, ticker) {
  const compactDate = String(date || "").replace(/-/g, "").slice(2);
  const count = state.transactions.filter((tx) => tx.date === date && tx.ticker === ticker && tx.type === "買入").length + 1;
  return `${compactDate}-${ticker}-${String(count).padStart(2, "0")}`;
}

async function handleTradeSubmit(event) {
  event.preventDefault();
  const type = document.getElementById("trade-type").value;
  const market = document.getElementById("trade-market").value;
  const ticker = document.getElementById("trade-ticker").value.trim();
  const date = document.getElementById("trade-date").value;
  const result = document.getElementById("trade-result");

  if (!ticker || !date) {
    result.classList.remove("hidden");
    result.innerHTML = `<strong class="loss">請填寫日期與股票代號</strong>`;
    return;
  }

  if (type === "賣出") {
    const validLots = updateSelectedSellLots();
    const selectedLots = document.getElementById("trade-sell-id")?.value || "";
    if (!validLots || !selectedLots) {
      result.classList.remove("hidden");
      result.innerHTML = `<strong class="loss">請選擇可賣出的庫存，且股數不可超過剩餘股數</strong>`;
      return;
    }
  }

  const payload = collectTradePayload(type, market, ticker, date);
  result.classList.remove("hidden");
  appendLocalTransaction(payload);
  await persistLocalState();
  renderAll();
  result.innerHTML = `<strong class="profit">交易已寫入本地資料庫</strong><span>目前不會回寫 Google Sheet。</span>`;
}

function collectTradePayload(type, market, ticker, date) {
  const valueOf = (id) => document.getElementById(id)?.value || "";
  return {
    date,
    market,
    ticker,
    type,
    price: valueOf("trade-price"),
    qty: valueOf("trade-qty"),
    fee: valueOf("trade-fee"),
    discount: valueOf("trade-discount"),
    sellId: valueOf("trade-sell-id"),
    divP: valueOf("trade-div-price"),
    divQ: valueOf("trade-div-qty"),
    other: valueOf("trade-other"),
    splitR: valueOf("trade-split-ratio"),
    splitPx: valueOf("trade-split-price"),
  };
}

function bindRefresh() {
  document.getElementById("refresh-button").addEventListener("click", () => loadData().catch(showAppError));
}

function bindLocalDataControls() {
  document.getElementById("backup-password-button")?.addEventListener("click", setBackupPassword);
  document.getElementById("backup-now-button")?.addEventListener("click", async () => {
    const password = await ensureBackupPassword();
    if (!password) return;
    try {
      const backup = await exportEncryptedBackup(password);
      state.latestBackup = backup;
      await setMeta("lastBackupDay", dateKey(new Date()));
      const cloudStatus = await uploadEncryptedBackup(backup);
      updateLocalDbStatus(`已建立加密備份：${formatDateTime(backup.createdAt)}${cloudStatus}`, "profit");
    } catch (err) {
      updateLocalDbStatus(`備份失敗：${err.message || err}`, "loss");
    }
  });
  document.getElementById("backup-download-button")?.addEventListener("click", async () => {
    const backups = await getBackupRecords();
    const backup = state.latestBackup || backups.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if (!backup) {
      updateLocalDbStatus("目前沒有可匯出的備份，請先建立加密備份。", "loss");
      return;
    }
    downloadBackup(backup);
    updateLocalDbStatus("已下載加密備份檔，可放到 iCloud Drive / Google Drive。", "profit");
  });
  document.getElementById("local-snapshot-button")?.addEventListener("click", handleLocalSnapshot);
  document.getElementById("backup-restore-input")?.addEventListener("change", handleBackupRestore);
  document.getElementById("bootstrap-import-button")?.addEventListener("click", () => {
    document.getElementById("sheet-import-input")?.click();
  });
  document.getElementById("sheet-import-input")?.addEventListener("change", handleSheetImport);
}

async function setBackupPassword() {
  const first = window.prompt("設定加密備份密碼。這個密碼不會存進備份檔，請自行記住。");
  if (!first) return;
  const second = window.prompt("再輸入一次備份密碼。");
  if (first !== second) {
    updateLocalDbStatus("兩次密碼不同，尚未設定。", "loss");
    return;
  }
  sessionStorage.setItem("assetBackupPassword", first);
  localStorage.setItem("assetBackupPasswordConfigured", "1");
  await setMeta("backupPasswordConfiguredAt", new Date().toISOString());
  updateLocalDbStatus("備份密碼已設定於本次開啟期間。", "profit");
  await runAutoBackup();
}

async function ensureBackupPassword() {
  const saved = sessionStorage.getItem("assetBackupPassword");
  if (saved) return saved;
  const password = window.prompt("請輸入加密備份密碼。");
  if (!password) {
    updateLocalDbStatus("未輸入備份密碼，無法建立加密備份。", "loss");
    return "";
  }
  sessionStorage.setItem("assetBackupPassword", password);
  return password;
}

async function handleBackupRestore(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  const password = await ensureBackupPassword();
  if (!password) return;
  try {
    const dataset = await restoreEncryptedBackup(file, password);
    applyDataset(dataset);
    renderAll();
    updateLocalDbStatus("已從加密備份還原到本地資料庫。", "profit");
  } catch (err) {
    updateLocalDbStatus(`還原失敗：${err.message || err}`, "loss");
  }
}

async function handleBootstrapImport() {
  try {
    const dataset = await reloadFromBootstrap();
    applyDataset(dataset);
    renderAll();
    updateLocalDbStatus("已重新匯入目前的 Sheet 匯出檔。", "profit");
  } catch (err) {
    updateLocalDbStatus(`匯入失敗：${err.message || err}`, "loss");
  }
}

async function handleSheetImport(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const dataset = await importDatasetFile(file);
    applyDataset(dataset);
    renderAll();
    updateLocalDbStatus(`已匯入 ${file.name}，資料已寫入本機 IndexedDB。`, "profit");
    window.setTimeout(() => window.location.reload(), 500);
  } catch (err) {
    updateLocalDbStatus(`匯入失敗：${err.message || err}`, "loss");
  }
}

async function handleLocalSnapshot() {
  try {
    const dataset = state.dataset || { schemaVersion: 1, source: "local", data: {} };
    dataset.data = {
      ...(dataset.data || {}),
      trend: serializeTrendRows(state.trend),
      overview: state.overview,
      stocks: state.stocks.map(stockToSheetRow),
      transactions: state.transactions.map(transactionToSheetRow),
      retirement: dataset.data?.retirement || [],
      dailyHoldings: dataset.data?.dailyHoldings || [],
      dailyPrices: dataset.data?.dailyPrices || [],
      dailyAssetSnapshots: dataset.data?.dailyAssetSnapshots || [],
    };
    state.dataset = await saveLocalDataset(recalculateDataset(dataset, { snapshot: true }));
    applyDataset(state.dataset);
    renderAll();
    updateLocalDbStatus("已依目前資產總覽建立本地快照。", "profit");
  } catch (err) {
    updateLocalDbStatus(`建立快照失敗：${err.message || err}`, "loss");
  }
}

async function runAutoBackup() {
  const backups = await getBackupRecords();
  const lastBackupDay = await getMeta("lastBackupDay");
  const now = new Date();
  const shouldAskForPassword = !backups.length || (now.getHours() >= 14 && lastBackupDay !== dateKey(now));
  let password = sessionStorage.getItem("assetBackupPassword");
  if (!password && shouldAskForPassword) password = await ensureBackupPassword();
  const result = await maybeAutoBackup(password);
  const lastBackupAt = await getMeta("lastBackupAt");
  if (result.backup) {
    state.latestBackup = result.backup;
    const cloudStatus = await uploadEncryptedBackup(result.backup);
    updateLocalDbStatus(`已自動建立加密備份：${formatDateTime(result.backup.createdAt)}${cloudStatus}`, "profit");
  } else if (lastBackupAt) {
    updateLocalDbStatus(`最新本地加密備份：${formatDateTime(lastBackupAt)}`, "neutral");
  } else {
    updateLocalDbStatus("尚未建立加密備份，請先設定備份密碼。", "neutral");
  }
}

function updateLocalDbSource(dataset) {
  const source = dataset?.source || "本地資料庫";
  const exportedAt = dataset?.exportedAt ? formatDateTime(dataset.exportedAt) : "";
  setText("local-db-source", exportedAt ? `${source} / ${exportedAt}` : source);
}

function updateLocalDbStatus(message, tone = "neutral") {
  const el = document.getElementById("local-db-status");
  if (!el) return;
  el.classList.remove("hidden");
  el.innerHTML = `<strong class="${tone}">${escapeHtml(message)}</strong>`;
}

async function uploadEncryptedBackup(backup) {
  const endpoint = window.ASSET_PWA_CONFIG?.encryptedBackupEndpoint || "";
  if (!endpoint) return "，尚未設定雲端端點";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backup),
    });
    if (!response.ok) throw new Error(String(response.status));
    return "，已同步加密檔到雲端";
  } catch (err) {
    return `，雲端同步失敗(${err.message || err})`;
  }
}

function bindAuthForm() {
  document.getElementById("auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const pin = document.getElementById("auth-pin").value.trim();
    const result = document.getElementById("auth-result");
    if (!pin) {
      result.classList.remove("hidden");
      result.innerHTML = `<strong class="loss">請輸入 PIN</strong>`;
      return;
    }

    sessionStorage.setItem("assetPwaPin", pin);
    result.classList.remove("hidden");
    result.innerHTML = `<strong>正在讀取試算表...</strong>`;
    try {
      await loadData();
      hideAuthScreen();
      document.getElementById("auth-pin").value = "";
    } catch (err) {
      sessionStorage.removeItem("assetPwaPin");
      result.innerHTML = `<strong class="loss">登入失敗</strong><span>${escapeHtml(err.message || String(err))}</span>`;
    }
  });
}

function needsAuth() {
  const config = getApiConfig();
  return Boolean(config.gasApiUrl && config.requirePin && !config.pin);
}

function showAuthScreen() {
  document.getElementById("auth-screen").classList.remove("hidden");
  document.querySelector(".app-shell").classList.add("hidden");
}

function hideAuthScreen() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.querySelector(".app-shell").classList.remove("hidden");
}

function showAppError(err) {
  const status = document.getElementById("app-status");
  status.classList.remove("hidden");
  status.innerHTML = `<strong class="loss">資料讀取失敗</strong><span>${escapeHtml(err.message || String(err))}</span>`;
}

function hideAppError() {
  const status = document.getElementById("app-status");
  status.classList.add("hidden");
  status.innerHTML = "";
}

function getApiConfig() {
  const config = window.ASSET_PWA_CONFIG || {};
  return {
    gasApiUrl: localStorage.getItem("gasApiUrl") || config.gasApiUrl || "",
    requirePin: config.requirePin !== false,
    pin: sessionStorage.getItem("assetPwaPin") || "",
  };
}

function hasRemoteApi() {
  return Boolean(getApiConfig().gasApiUrl);
}

async function apiRun(action, params = {}) {
  const response = await jsonpRequest(action, params);
  if (response?.ok === false) throw new Error(response.error || "API 執行失敗");
  return Object.prototype.hasOwnProperty.call(response || {}, "data") ? response.data : response;
}

function jsonpRequest(action, params = {}) {
  const { gasApiUrl, pin } = getApiConfig();
  if (!gasApiUrl) return Promise.reject(new Error("尚未設定 GAS_API_URL"));

  return new Promise((resolve, reject) => {
    const callbackName = `assetPwaJsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`API 逾時：${action}`));
    }, API_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    const url = new URL(gasApiUrl);
    url.searchParams.set("action", action);
    url.searchParams.set("callback", callbackName);
    if (pin) url.searchParams.set("pin", pin);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    });

    script.onerror = () => {
      cleanup();
      reject(new Error(`API 載入失敗：${action}`));
    };
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

function showDayDetail(key) {
  const targetDate = parseDate(key);
  const row = (targetDate ? calendarRowsInMonth(targetDate) : []).find((item) => dateKey(item.date) === key);
  if (!row) return;
  const dialog = document.getElementById("day-dialog");
  document.getElementById("day-detail").innerHTML = `
    <h2>${formatFullDate(row.date)}</h2>
    <div class="detail-list">
      ${detailRow("淨資產", formatMoney(row.netWorth))}
      ${detailRow("股票每日損益", formatSignedMoney(row.totalPnl), row.totalPnl)}
      ${detailRow("股票每日報酬率", formatSignedPercent(row.totalRate), row.totalRate)}
      ${detailRow("台股", `${formatMoney(row.tw)} / ${formatSignedMoney(row.twPnl)}`, row.twPnl)}
      ${detailRow("美股", `${formatMoney(row.us)} / ${formatSignedMoney(row.usPnl)}`, row.usPnl)}
      ${detailRow("流動資金", `${formatMoney(row.cash)} / ${formatSignedMoney(row.cashPnl || 0)}`, row.cashPnl || 0)}
    </div>
  `;
  dialog.showModal();
}

function getCalendarPnl(row) {
  if (state.calendarMode === "tw") return row.twPnl;
  if (state.calendarMode === "us") return row.usPnl;
  if (state.calendarMode === "cash") return row.cashPnl;
  return row.totalPnl;
}

function getCalendarRate(row) {
  if (state.calendarMode === "tw") return row.twRate;
  if (state.calendarMode === "us") return row.usRate;
  if (state.calendarMode === "cash") return row.cashRate;
  return row.totalRate;
}

function calendarRowsInMonth(date) {
  return (state.calendarMode === "cash" ? cashRowsInMonth(date) : marketPnlRowsInMonth(date))
    .filter((row) => hasCalendarMovement(row));
}

function marketPnlRowsInMonth(date) {
  return buildMarketPnlRows().filter((row) => row.date.getFullYear() === date.getFullYear() && row.date.getMonth() === date.getMonth());
}

function cashRowsInMonth(date) {
  return buildCashRows().filter((row) => row.date.getFullYear() === date.getFullYear() && row.date.getMonth() === date.getMonth());
}

function latestMarketPnlRow() {
  return buildMarketPnlRows().reduce((pick, row) => (!pick || row.date > pick.date ? row : pick), null);
}

function latestCashPnlRow() {
  return buildCashRows().reduce((pick, row) => (!pick || row.date > pick.date ? row : pick), null);
}

function latestPnlStatsForSeries(seriesKey) {
  if (seriesKey === "cash") {
    const row = latestCashPnlRow();
    return row ? { pnl: row.cashPnl, rate: row.cashRate } : null;
  }
  const row = latestMarketPnlRow();
  if (!row) return null;
  if (seriesKey === "tw") return { pnl: row.twPnl, rate: row.twRate };
  if (seriesKey === "us") return { pnl: row.usPnl, rate: row.usRate };
  return { pnl: row.totalPnl, rate: row.totalRate };
}

function buildCashRows() {
  const sourceRows = state.dailyAssetSnapshots.length ? state.dailyAssetSnapshots : state.trend;
  return sourceRows
    .filter((row) => !isWeekend(row.date))
    .sort((a, b) => a.date - b.date)
    .map((row, index, rows) => {
      const prev = rows[index - 1];
      const cashPnl = prev ? row.cash - prev.cash : row.cashPnl || 0;
      return {
        ...row,
        cashPnl,
        cashRate: prev ? safeRate(cashPnl, prev.cash) : row.cashRate || 0,
      };
    });
}

function hasCalendarMovement(row) {
  if (state.calendarMode === "tw") return row.twOpen ?? row.twPnl !== 0;
  if (state.calendarMode === "us") return row.usOpen ?? row.usPnl !== 0;
  if (state.calendarMode === "cash") return row.cashPnl !== 0;
  return row.twOpen || row.usOpen || row.totalPnl !== 0 || row.twPnl !== 0 || row.usPnl !== 0;
}

function buildMarketPnlRows() {
  if (!state.dailyHoldings.length || !state.dailyPrices.length) return [];

  const flowMap = buildInvestmentFlowsByDate(state.transactions);
  const priceMap = new Map();
  state.dailyPrices.forEach((row) => {
    const date = String(row["日期"] || row.date || "").slice(0, 10);
    const market = String(row["市場"] || row.market || "").trim();
    const ticker = normalizeHistoricalTicker(market, row["股票代號"] ?? row.ticker);
    if (!date || !market || !ticker) return;
    priceMap.set(historicalKey(date, market, ticker), {
      closeTwd: toNumber(row["台幣收盤價"] ?? row.closeTwd),
      exact: !String(row["資料來源"] || row.source || "").includes("前值補價"),
    });
  });

  const holdingsByDate = new Map();
  state.dailyHoldings.forEach((row) => {
    const date = String(row["日期"] || row.date || "").slice(0, 10);
    const market = String(row["市場"] || row.market || "").trim();
    const ticker = normalizeHistoricalTicker(market, row["股票代號"] ?? row.ticker);
    const qty = toNumber(row["持股股數"] ?? row.qty);
    if (!date || !market || !ticker || !(qty > 0)) return;
    if (!holdingsByDate.has(date)) holdingsByDate.set(date, []);
    holdingsByDate.get(date).push({ market, ticker, qty });
  });

  const lastValue = { 台股: null, 美股: null };
  return [...holdingsByDate.keys()]
    .sort()
    .map((key) => {
      const date = parseDate(key);
      if (!date || isWeekend(date)) return null;
      const marketValues = { 台股: 0, 美股: 0 };
      const marketOpen = { 台股: false, 美股: false };
      const marketMissingPrice = { 台股: false, 美股: false };

      holdingsByDate.get(key).forEach((holding) => {
        const price = priceMap.get(historicalKey(key, holding.market, holding.ticker));
        if (!price || !price.exact || !(price.closeTwd > 0)) {
          marketMissingPrice[holding.market] = true;
          return;
        }
        marketOpen[holding.market] = true;
        marketValues[holding.market] += Math.floor(holding.qty * price.closeTwd);
      });

      if (marketMissingPrice["台股"]) {
        marketOpen["台股"] = false;
        marketValues["台股"] = 0;
      }
      if (marketMissingPrice["美股"]) {
        marketOpen["美股"] = false;
        marketValues["美股"] = 0;
      }

      const twPnl = marketOpen["台股"] && lastValue["台股"] !== null ? marketValues["台股"] - lastValue["台股"] : 0;
      const usPnl = marketOpen["美股"] && lastValue["美股"] !== null ? marketValues["美股"] - lastValue["美股"] : 0;
      const twBase = lastValue["台股"] || 0;
      const usBase = lastValue["美股"] || 0;

      if (marketOpen["台股"]) lastValue["台股"] = marketValues["台股"];
      if (marketOpen["美股"]) lastValue["美股"] = marketValues["美股"];
      if (!marketOpen["台股"] && !marketOpen["美股"]) return null;

      const flows = flowMap.get(key) || emptyInvestmentFlow();
      const adjustedTwPnl = marketOpen["台股"] ? twPnl - flows.tw.buy + flows.tw.sell + flows.tw.income : 0;
      const adjustedUsPnl = marketOpen["美股"] ? usPnl - flows.us.buy + flows.us.sell + flows.us.income : 0;
      const totalPnl = adjustedTwPnl + adjustedUsPnl;
      const totalBase = (marketOpen["台股"] ? twBase : 0) + (marketOpen["美股"] ? usBase : 0);
      return {
        date,
        tw: marketValues["台股"],
        us: marketValues["美股"],
        cash: 0,
        netWorth: marketValues["台股"] + marketValues["美股"],
        twPnl: adjustedTwPnl,
        usPnl: adjustedUsPnl,
        totalPnl,
        twRate: safeRate(adjustedTwPnl, twBase),
        usRate: safeRate(adjustedUsPnl, usBase),
        totalRate: safeRate(totalPnl, totalBase),
        twOpen: marketOpen["台股"],
        usOpen: marketOpen["美股"],
      };
    })
    .filter(Boolean);
}

function historicalKey(date, market, ticker) {
  return `${date}|${market}|${ticker}`;
}

function normalizeHistoricalTicker(market, value) {
  const text = String(value ?? "").trim().replace(/^'/, "");
  if (!text) return "";
  if (market !== "台股") return text.toUpperCase();
  const map = { "50": "0050", "56": "0056", "6208": "006208" };
  return map[text] || text.padStart(4, "0");
}

function representedTradingDate(row) {
  const snapshotDate = parseDate(row.snapshotTime);
  const date = new Date(row.date);
  if (snapshotDate && dateKey(snapshotDate) === dateKey(date) && snapshotHour(row.snapshotTime) < 12) {
    return previousWeekday(date);
  }
  return date;
}

function previousWeekday(date) {
  const next = new Date(date);
  do {
    next.setDate(next.getDate() - 1);
  } while (isWeekend(next));
  return next;
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function snapshotHour(value) {
  const text = String(value || "");
  const amPmMatch = text.match(/\b(AM|PM)\s+(\d{1,2}):/i);
  if (amPmMatch) {
    let hour = Number(amPmMatch[2]) || 0;
    if (/PM/i.test(amPmMatch[1]) && hour < 12) hour += 12;
    if (/AM/i.test(amPmMatch[1]) && hour === 12) hour = 0;
    return hour;
  }
  const isoMatch = text.match(/T(\d{1,2}):/);
  if (isoMatch) return Number(isoMatch[1]) || 0;
  return 24;
}

function snapshotPriority(row) {
  return String(row.snapshotTime || "").includes("T") ? 2 : 1;
}

function firstDisplayWeekday(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return 0;
  return day - 1;
}

function calcMonthlyCalendarRate(monthDate, total) {
  const rows = calendarRowsInMonth(monthDate);
  if (!rows.length) return 0;
  const first = rows[0];
  let base = first.tw + first.us - getCalendarPnl(first);
  if (state.calendarMode === "tw") base = first.tw - first.twPnl;
  if (state.calendarMode === "us") base = first.us - first.usPnl;
  if (state.calendarMode === "cash") base = first.cash - first.cashPnl;
  return safeRate(total, base);
}

function isComputedInvestmentChild(groupName, childName) {
  return groupName === "投資" && ["台股", "美股"].includes(childName);
}

function latestByDate(rows) {
  return rows.reduce((pick, row) => {
    const current = parseDate(row.date);
    const picked = pick ? parseDate(pick.date) : null;
    if (!current) return pick;
    return !picked || current > picked ? row : pick;
  }, null);
}

function metricCard(label, value, sub, tone = null) {
  return `
    <article class="metric-card">
      <span class="metric-label">${label}</span>
      <strong class="metric-value ${toneClassName(tone)}">${value}</strong>
      <span class="metric-sub">${sub}</span>
    </article>
  `;
}

function metricMini(label, value, tone = null) {
  return `<div><span class="metric-label">${label}</span><strong class="metric-value ${toneClassName(tone)}">${value}</strong></div>`;
}

function summaryPill(label, value, tone = null) {
  const valueText = String(value);
  const isMarkup = valueText.includes("<");
  return `<div class="summary-pill"><span>${label}</span><strong class="${isMarkup ? "" : toneClassName(tone)}">${value}</strong></div>`;
}

function summaryDateMoney(date, pnl, plain = false) {
  return `
    <span class="summary-date-money">
      <span class="summary-date">${date ? formatDate(date) : "--"}</span>
      <span class="${toneClass(pnl)}">${plain ? formatCalendarMoney(pnl) : formatMoney(Math.abs(pnl))}</span>
    </span>
  `;
}

function formatCalendarMoney(value) {
  return money.format(Math.abs(value || 0));
}

function formatStockPct(value) {
  if (typeof value === "number") return percent.format(Math.abs(value) > 1 ? value / 100 : value);
  const text = String(value || "").trim();
  if (!text) return "0.00%";
  if (text.includes("%")) return escapeHtml(text);
  const n = toNumber(text);
  return percent.format(Math.abs(n) > 1 ? n / 100 : n);
}

function formatPercentPlain(value) {
  return percent.format(Math.abs(value));
}

function normalizeColor(value) {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  const colorMap = {
    "var(--cash)": "#f2b33d",
    "var(--tw)": "#6fc2a4",
    "var(--us)": "#6d79ff",
    "var(--debt)": "#737373",
    "var(--neutral)": "#74747e",
    "var(--profit)": "#ef4444",
    "var(--loss)": "#22c55e",
  };
  return colorMap[text] || "#74747e";
}

function detailRow(label, value, tone = null) {
  return `<div class="detail-row"><span>${label}</span><strong class="${toneClassName(tone)}">${value}</strong></div>`;
}

function parseDate(value) {
  const match = String(value || "").match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toNumber(value) {
  if (typeof value === "number") return value;
  return Number(String(value || "").replace(/[,%"]/g, "").trim()) || 0;
}

function toRate(value) {
  if (typeof value === "number") return value > 3 ? value / 100 : value;
  const text = String(value || "").trim();
  if (!text) return 0;
  const n = toNumber(text);
  return text.includes("%") ? n / 100 : n;
}

function retirementGoalFromRows(rows = []) {
  const row = rows.find((item) => String(item["項目"] || "").trim() === "退休目標");
  return toNumber(row?.["數值"]);
}

function safeRate(value, base) {
  return base ? value / base : 0;
}

function formatMoney(value) {
  return `$ ${money.format(value || 0)}`;
}

function formatSignedMoney(value, compact = false) {
  const abs = Math.abs(value || 0);
  if (compact && abs >= 10000) return `${Math.round(abs / 10000)}萬`;
  return `$ ${money.format(abs)}`;
}

function formatSignedPercent(value) {
  return percent.format(Math.abs(value || 0));
}

function formatPercent(value, digits = 2) {
  return `${((value || 0) * 100).toFixed(digits)}%`;
}

function formatDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatFullDate(date) {
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "--");
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatQty(value) {
  return Number(value || 0).toLocaleString("zh-TW", { maximumFractionDigits: 5 });
}

function formatPrice(value) {
  return Number(value || 0).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function formatPriceWithUnit(value, market) {
  const suffix = market === "美股" ? " USD" : " 元";
  return `${formatPrice(value)}${suffix}`;
}

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toneClass(value) {
  if (value > 0) return "profit";
  if (value < 0) return "loss";
  return "neutral";
}

function toneClassName(value) {
  return value === null || value === undefined ? "" : toneClass(value);
}

function setTone(el, value) {
  el.classList.remove("profit", "loss", "neutral");
  el.classList.add(toneClass(value));
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\"');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
}
