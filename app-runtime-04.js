realizedPnl)}
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
    ${lots.length ? lots.map(renderTradeLot).join(