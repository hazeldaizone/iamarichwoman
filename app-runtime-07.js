bindAuthForm() {
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
  const row = buildCalendarRows().find((item) => dateKey(item.date) === key);
  if (!row) return;
  const dialog = document.getElementById("day-dialog");
  document.getElementById("day-detail").innerHTML = `
    <h2>${formatFullDate(row.date)}</h2>
    <div class="detail-list">
      ${detailRow("淨資產", formatMoney(row.netWorth))}
      ${detailRow("每日損益", formatSignedMoney(row.totalPnl), row.totalPnl)}
      ${detailRow("每日報酬率", formatSignedPercent(row.totalRate), row.totalRate)}
      ${detailRow("台股", `${formatMoney(row.tw)} / ${formatSignedMoney(row.twPnl)}`, row.twPnl)}
      ${detailRow("美股", `${formatMoney(row.us)} / ${formatSignedMoney(row.usPnl)}`, row.usPnl)}
      ${detailRow("流動資金", formatMoney(row.cash))}
    </div>
  `;
  dialog.showModal();
}

function getCalendarPnl(row) {
  if (state.calendarMode === "tw") return row.twPnl;
  if (state.calendarMode === "us") return row.usPnl;
  return row.totalPnl;
}

function getCalendarRate(row) {
  if (state.calendarMode === "tw") return row.twRate;
  if (state.calendarMode === "us") return row.usRate;
  return row.totalRate;
}

function rowsInMonth(date) {
  return state.trend.filter((row) => row.date.getFullYear() === date.getFullYear() && row.date.getMonth() === date.getMonth());
}

function calendarRowsInMonth(date) {
  const rows = buildCalendarRowsFromHoldingsAndPrices()
    .filter((row) => row.date.getFullYear() === date.getFullYear() && row.date.getMonth() === date.getMonth())
    .filter((row) => hasCalendarMovement(row));
  if (rows.length) return rows;
  return buildCalendarRows()
    .filter((row) => row.date.getFullYear() === date.getFullYear() && row.date.getMonth() === date.getMonth())
    .filter((row) => hasCalendarMovement(row));
}

function buildCalendarRows() {
  if (state.dailyAssetSnapshots.length) return state.dailyAssetSnapshots.filter((row) => !isWeekend(row.date)).sort((a, b) => a.date - b.date);

  const merged = new Map();
  state.trend.forEach((row) => {
    const represented = representedTradingDate(row);
    if (!represented || isWeekend(represented)) return;
    const twPnl = row.rawTwPnl ?? row.twPnl ?? 0;
    const usPnl = row.rawUsPnl ?? row.usPnl ?? 0;
    const current = {
      ...row,
      date: represented,
      twPnl,
      usPnl,
      totalPnl: twPnl + usPnl,
      twRate: row.rawTwRate ?? row.twRate ?? 0,
      usRate: row.rawUsRate ?? row.usRate ?? 0,
    };
    current.totalRate = safeRate(current.totalPnl, Math.max(0, row.tw + row.us - current.totalPnl));
    const key = dateKey(represented);
    const existing = merged.get(key);
    if (!existing || snapshotPriority(current) >= snapshotPriority(existing)) merged.set(key, current);
  });
  return [...merged.values()].sort((a, b) => a.date - b.date);
}

function hasCalendarMovement(row) {
  if (state.calendarMode === "tw") return row.twOpen ?? row.twPnl !== 0;
  if (state.calendarMode === "us") return row.usOpen ?? row.usPnl !== 0;
  return row.twOpen || row.usOpen || row.totalPnl !== 0 || row.twPnl !== 0 || row.usPnl !== 0;
}

function buildCalendarRowsFromHoldingsAndPrices() {
  if (!state.dailyHoldings.length || !state.dailyPrices.length) return [];

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

      holdingsByDate.get(key).forEach((holding) => {
        const price = priceMap.get(historicalKey(key, holding.market, holding.ticker));
        if (!price) return;
        if (price.exact) marketOpen[holding.market] = true;
        marketValues[holding.market] += Math.floor(holding.qty * price.closeTwd);
      });

      const twPnl = marketOpen["台股"] && lastValue["台股"] !== null ? marketValues["台股"] - lastValue["台股"] : 0;
      const usPnl = marketOpen["美股"] && lastValue["美股"] !== null ? marketValues["美股"] - lastValue["美股"] : 0;
      const twBase = lastValue["台股"] || 0;
      const usBase = lastValue["美股"] || 0;

      if (marketOpen["台股"]) lastValue["台股"] = marketValues["台股"];
      if (marketOpen["美股"]) lastValue["美股"] = marketValues["美股"];
      if (!marketOpen["台股"] && !marketOpen["美股"]) return null;

      const totalPnl = (marketOpen["台股"] ? twPnl : 0) + (marketOpen["美股"] ? usPnl : 0);
      const totalBase = (marketOpen["台股"] ? twBase : 0) + (marketOpen["美股"] ? usBase : 0);
      return {
        date,
        tw: marketValues["台股"],
        us: marketValues["美股"],
        cash: 0,
        netWorth: marketValues["台股"] + marketValues["美股"],
        twPnl,
        usPnl,
        totalPnl,
        twRate: safeRate(twPnl, twBase),
        usRate: safeRate(usPnl, usBase),
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

function metricCard(label, value,