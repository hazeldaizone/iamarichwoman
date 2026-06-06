["美元"]),
    fx: toNumber(row["美元匯率"]),
    net: toNumber(row["淨收支"]),
    realizedPnl: toNumber(row["已實現損益"]),
    remCost: toNumber(row["剩餘成本"]),
    sellRate: toRate(row["賣出報酬率"]),
    detail: row["損益細項"] || "",
  };
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
  const previous = state.trend[state.trend.length - 2];
  if (!latest) return;

  setText("latest-date", formatDate(latest.date));
  setText("net-worth", formatMoney(latest.netWorth));
  const change = previous ? latest.netWorth - previous.netWorth : latest.totalPnl;
  const changeRate = previous ? safeRate(change, previous.netWorth) : latest.totalRate;
  const changeEl = document.getElementById("net-change");
  changeEl.textContent = `昨日 ${formatSignedMoney(change)} / ${formatSignedPercent(changeRate)}`;
  setTone(changeEl, change);

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
  const selectedPnl = latest[config.pnl] || 0;
  const selectedRate = latest[config.rate] || 0;
  const comparisonMetrics = Object.entries(TREND_SERIES)
    .filter(([key]) => key !== state.activeTrendSeries && key !== "netWorth")
    .map(([, item]) => metricCard(`${item.label}每日損益`, formatSignedMoney(latest[item.pnl] || 0), formatSignedPercent(latest[item.rate] || 0), latest[item.pnl] || 0));

  document.getElementById("trend-metrics").innerHTML = [
    metricCard(`${config.label}每日損益`, formatSignedMoney(selectedPnl), formatSignedPercent(selectedRate), selectedPnl),
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
    <polyline points="${points.join(" ")} ${width - pad},${height - pad} ${pad},${height - pad}" fill="url(#chartFill)" stro