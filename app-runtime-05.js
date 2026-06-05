"") : `<div class="empty-state">查無可賣庫存</div>`}
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
    "日期": dateKey(ro