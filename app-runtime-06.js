 await saveLocalDataset(recalculateDataset(dataset));
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
  setText("local-db-source", exportedAt ? `${source} / $