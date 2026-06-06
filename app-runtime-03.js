ke="none"></polyline>
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
  const rows = rowsInMonth(state.calendarDate);
  const monthlyTotal = rows.reduce((sum, row) => sum + row.totalPnl, 0);
  const monthlyTw = rows.reduce((sum, row) => sum + row.twPnl, 0);
  const monthlyUs = rows.reduce((sum, row) => sum + row.usPnl, 0);
  const averageRate = rows.length ? rows.reduce((sum, row) => sum + row.totalRate, 0) / rows.length : 0;

  const analysis = [
    ["本月總損益", formatSignedMoney(monthlyTotal), monthlyTotal],
    ["台股貢獻", formatSignedMoney(monthlyTw), monthlyTw],
    ["美股貢獻", formatSignedMoney(monthlyUs), monthlyUs],
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
      ${metricMini("庫存股數", `${forma