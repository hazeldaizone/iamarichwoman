const DAY_MS = 24 * 60 * 60 * 1000;
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const FALLBACK_USD_TWD = 31.5;
const TICKER_DISPLAY = {
  "6208": "006208",
  "50": "0050",
  "56": "0056",
};

export async function syncPublicMarketPrices(dataset, options = {}) {
  const data = dataset?.data || {};
  const end = startOfDay(options.now || new Date());
  const transactions = data.transactions || [];
  const instruments = collectInstruments(transactions, end);
  if (!instruments.length) {
    return { dataset, changed: false, fetched: 0, errors: [] };
  }

  const existing = data.dailyPrices || [];
  const existingByKey = new Map(existing.map((row) => [priceKey(row), row]).filter(([key]) => key));
  const syncJobs = instruments
    .map((instrument) => ({
      ...instrument,
      missing: missingDatesForInstrument(instrument, end, existingByKey),
    }))
    .filter((job) => job.missing.length);

  if (!syncJobs.length) {
    return { dataset, changed: false, fetched: 0, errors: [] };
  }

  const firstMissing = syncJobs
    .flatMap((job) => job.missing)
    .sort((a, b) => a - b)[0];
  const fxSeries = await fetchFxSeries(addDays(firstMissing, -10), end, latestFxFromDataset(dataset));
  const nextRows = [...existing];
  const errors = [];
  let fetched = 0;

  for (const job of syncJobs) {
    const yahooSymbol = yahooSymbolFor(job.market, job.ticker);
    if (!yahooSymbol) {
      errors.push(`${job.market} ${job.ticker} 無法轉換 Yahoo 代號`);
      continue;
    }

    const start = addDays(job.missing[0], -10);
    try {
      const raw = await fetchYahooHistory(yahooSymbol, start, end);
      const rows = materializeDailyPriceRows({
        instrument: job,
        raw,
        start: job.missing[0],
        end,
        existingByKey,
        fxSeries,
      });
      rows.forEach((row) => {
        existingByKey.set(priceKey(row), row);
        nextRows.push(row);
      });
      fetched += rows.length;
    } catch (err) {
      errors.push(`${job.market} ${job.ticker} 抓價失敗：${err.message || err}`);
    }
  }

  const merged = [...new Map(nextRows.map((row) => [priceKey(row), row]).filter(([key]) => key)).values()]
    .sort((a, b) => {
      const ad = text(a["日期"]);
      const bd = text(b["日期"]);
      if (ad !== bd) return ad.localeCompare(bd);
      const am = text(a["市場"]);
      const bm = text(b["市場"]);
      if (am !== bm) return am.localeCompare(bm);
      return text(a["股票代號"]).localeCompare(text(b["股票代號"]));
    });

  return {
    dataset: {
      ...dataset,
      exportedAt: new Date().toISOString(),
      data: {
        ...data,
        dailyPrices: merged,
      },
    },
    changed: fetched > 0,
    fetched,
    errors,
  };
}

function collectInstruments(transactions, end) {
  const byKey = new Map();
  transactions.forEach((row) => {
    const market = text(row["市場"]);
    const ticker = normalizeTicker(row["標的"]);
    const date = parseDate(row["日期"]);
    const type = text(row["交易類型"]);
    if (!["台股", "美股"].includes(market) || !ticker || !date || date > end) return;
    if (!["買入", "賣出", "配息", "分割", "結轉"].includes(type)) return;
    const key = `${market}|${ticker}`;
    const previous = byKey.get(key);
    if (!previous || date < previous.firstDate) {
      byKey.set(key, { market, ticker, firstDate: startOfDay(date) });
    }
  });
  return [...byKey.values()].sort((a, b) => `${a.market}${a.ticker}`.localeCompare(`${b.market}${b.ticker}`));
}

function missingDatesForInstrument(instrument, end, existingByKey) {
  const missing = [];
  for (const day of dateRange(instrument.firstDate, end)) {
    if (!existingByKey.has(composePriceKey(dateKey(day), instrument.market, instrument.ticker))) {
      missing.push(day);
    }
  }
  return missing;
}

function materializeDailyPriceRows({ instrument, raw, start, end, existingByKey, fxSeries }) {
  const exactCloseByDate = new Map(raw.map((row) => [dateKey(row.date), row.close]));
  let lastClose = latestExistingCloseBefore(existingByKey, instrument, start);
  const rows = [];
  for (const day of dateRange(start, end)) {
    const key = dateKey(day);
    const exactClose = exactCloseByDate.get(key);
    const exact = exactClose !== undefined;
    if (exact) lastClose = exactClose;
    if (!(lastClose > 0)) continue;
    const fx = instrument.market === "美股" ? fxSeries.get(key) || latestFxBefore(fxSeries, day) || FALLBACK_USD_TWD : 1;
    rows.push({
      "日期": key,
      "市場": instrument.market,
      "股票代號": instrument.ticker,
      "收盤價": lastClose,
      "幣別": instrument.market === "美股" ? "USD" : "TWD",
      "匯率": fx,
      "台幣收盤價": lastClose * fx,
      "資料來源": `${exact ? "Yahoo Finance" : "Yahoo Finance (前值補價)"}; PWA公開價格同步`,
      "更新時間": new Date().toISOString(),
    });
  }
  return rows;
}

async function fetchFxSeries(start, end, fallbackFx) {
  try {
    const rows = await fetchYahooHistory("TWD=X", start, end);
    const exact = new Map(rows.map((row) => [dateKey(row.date), row.close]));
    const fx = new Map();
    let last = fallbackFx || FALLBACK_USD_TWD;
    for (const day of dateRange(start, end)) {
      const key = dateKey(day);
      if (exact.has(key)) last = exact.get(key);
      fx.set(key, last);
    }
    return fx;
  } catch {
    const fx = new Map();
    const fallback = fallbackFx || FALLBACK_USD_TWD;
    for (const day of dateRange(start, end)) fx.set(dateKey(day), fallback);
    return fx;
  }
}

async function fetchYahooHistory(symbol, start, end) {
  const period1 = Math.floor(start.getTime() / 1000);
  const period2 = Math.floor(addDays(end, 2).getTime() / 1000);
  const url = `${YAHOO_CHART_URL}${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`;
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error(payload?.chart?.error?.description || "Yahoo 無資料");
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  return timestamps
    .map((ts, index) => ({ date: new Date(ts * 1000), close: Number(closes[index]) }))
    .filter((row) => row.close > 0)
    .map((row) => ({ date: startOfDay(row.date), close: row.close }));
}

function latestExistingCloseBefore(existingByKey, instrument, beforeDate) {
  const prefix = `${instrument.market}|${instrument.ticker}|`;
  let latest = null;
  existingByKey.forEach((row, key) => {
    if (!key.startsWith(prefix)) return;
    const day = parseDate(row["日期"]);
    if (!day || day >= beforeDate) return;
    if (!latest || day > latest.date) latest = { date: day, close: number(row["收盤價"]) };
  });
  return latest?.close || 0;
}

function latestFxBefore(fxSeries, day) {
  let latest = null;
  fxSeries.forEach((value, key) => {
    const date = parseDate(key);
    if (date && date <= day && (!latest || date > latest.date)) latest = { date, value };
  });
  return latest?.value || 0;
}

function latestFxFromDataset(dataset) {
  const rows = dataset?.data?.dailyPrices || [];
  for (const row of [...rows].reverse()) {
    if (text(row["市場"]) === "美股" && number(row["匯率"]) > 0) return number(row["匯率"]);
  }
  for (const row of [...(dataset?.data?.transactions || [])].reverse()) {
    const fx = number(row["即時匯率"]) || number(row["美元匯率"]);
    if (fx > 0) return fx;
  }
  return FALLBACK_USD_TWD;
}

function yahooSymbolFor(market, ticker) {
  const symbol = normalizeTicker(ticker).toUpperCase();
  if (market === "台股") return /^\d{4,6}[A-Z]*$/.test(symbol) ? `${symbol}.TW` : "";
  if (market === "美股") return symbol;
  return "";
}

function priceKey(row) {
  const day = text(row?.["日期"] || row?.date).slice(0, 10);
  const market = text(row?.["市場"] || row?.market);
  const ticker = normalizeTicker(row?.["股票代號"] ?? row?.ticker);
  return day && market && ticker ? composePriceKey(day, market, ticker) : "";
}

function composePriceKey(day, market, ticker) {
  return `${text(market)}|${normalizeTicker(ticker)}|${text(day)}`;
}

function dateRange(start, end) {
  const rows = [];
  const cursor = startOfDay(start);
  const last = startOfDay(end);
  while (cursor <= last) {
    rows.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

function startOfDay(value) {
  const date = value instanceof Date ? value : parseDate(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  return new Date(startOfDay(date).getTime() + days * DAY_MS);
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const match = text(value).match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function dateKey(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeTicker(value) {
  const ticker = text(value).replace(/^'/, "").trim().toUpperCase();
  return TICKER_DISPLAY[ticker] || ticker;
}

function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return Number(String(value || "").replace(/[,%"]/g, "").trim()) || 0;
}

function text(value) {
  return String(value ?? "").trim();
}
