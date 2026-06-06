const DEFAULT_FX = 29.5;
const BROKER_RULES = {
  "台新證券": { defaultDiscount: 2.8, minFee: 20 },
  "永豐大戶": { defaultDiscount: 2, minFee: 1 },
};
const TYPE_RANK = {
  "結轉": 1,
  "分割": 2,
  "賣出": 3,
  "買入": 4,
  "配息": 5,
};
const TICKER_MAP = {
  "006208": "6208",
  "0050": "50",
  "0056": "56",
};
const TICKER_DISPLAY = {
  "6208": "006208",
  "50": "0050",
  "56": "0056",
};

export function recalculateDataset(dataset, options = {}) {
  const data = dataset?.data || {};
  const now = options.now || new Date();
  const liveFx = findLiveFx(data.transactions || [], data.stocks || []) || DEFAULT_FX;
  const priceByKey = buildPriceMap(data.stocks || [], data.dailyPrices || [], liveFx);
  const transactions = recalculateTransactions(data.transactions || [], priceByKey, liveFx);
  const stocks = buildStockSummary(transactions, data.stocks || [], liveFx);
  const overview = rebuildOverview(data.overview || [], stocks);
  const trend = options.snapshot ? upsertTodaySnapshot(data.trend || [], overview, transactions, now) : (data.trend || []);
  const historical = options.historical
    ? rebuildHistoricalTables(transactions, data.dailyPrices || [], data.dailyAssetSnapshots || [], overview, now)
    : {
      dailyHoldings: data.dailyHoldings || [],
      dailyAssetSnapshots: data.dailyAssetSnapshots || [],
    };
  return {
    ...dataset,
    exportedAt: new Date().toISOString(),
    data: {
      ...data,
      transactions,
      stocks,
      overview,
      trend,
      dailyHoldings: historical.dailyHoldings,
      dailyAssetSnapshots: historical.dailyAssetSnapshots,
    },
  };
}

function normalizeComputedTransactions(rows, priceByKey, liveFx) {
  const working = rows.map((row) => ({ ...row }));
  generateBuyIds(working);
  working.forEach((row) => {
    if (!isLocalRow(row)) return;
    const type = text(row["交易類型"]);
    const market = text(row["市場"]);
    const ticker = normalizeTicker(text(row["標的"]));
    const price = number(row["成交單價"]);
    const qty = number(row["股數"]);
    const fee = ensureFee(row);
    const other = number(row["匯費／其他費用"]);
    const rebate = number(row["折讓金額"]);
    const divP = number(row["配息單價"]);
    const divQ = number(row["配息股數"]);
    const fx = market === "美股" ? number(row["美元匯率"]) || liveFx : 1;
    const priceInfo = priceByKey.get(stockKey(market, ticker)) || {};
    const currentPrice = number(row["股票現價"]) || priceInfo.price || price;
    const usd = market === "美股" ? calcTradeUsdAmount(type, price, qty, fee, other, rebate, divP, divQ) : "";
    const net = calcTradeTwdNet(market, type, price, qty, fee, other, rebate, divP, divQ, fx);

    row["標的"] = ticker;
    row["手續費／稅金"] = fee || row["手續費／稅金"] || 0;
    row["美元"] = usd;
    row["美元匯率"] = market === "美股" && ["買入", "賣出", "配息"].includes(type) ? fx : row["美元匯率"];
    row["即時匯率"] = market === "美股" ? liveFx : row["即時匯率"];
    row["股票現價"] = currentPrice;
    row["淨收支"] = net;

    if (type === "買入") {
      const cost = -number(net);
      row["剩餘股數"] = number(row["剩餘股數"]) || qty;
      row["剩餘成本"] = number(row["剩餘成本"]) || -round0(cost);
      row["未實現損益"] = round0(currentPrice * number(row["剩餘股數"]) * fx - Math.abs(number(row["剩餘成本"])));
      row["未實現報酬率"] = Math.abs(number(row["剩餘成本"])) ? number(row["未實現損益"]) / Math.abs(number(row["剩餘成本"])) : 0;
      row["狀態"] = statusForComputedBuy(row);
    } else if (type === "配息") {
      row["配息金額"] = round0(market === "美股" ? number(usd) * fx : divP * divQ - other);
      row["狀態"] = "股利";
    } else if (type === "賣出") {
      row["狀態"] = "已實現";
    }
  });
  return working.sort(compareDisplay);
}

function recalculateTransactions(rows, priceByKey, liveFx) {
  const working = rows.map((row) => ({ ...row }));
  generateBuyIds(working);

  const chronological = [...working].sort(compareChronological);
  const batches = new Map();
  const splitSourceIds = new Set();

  chronological.forEach((row) => {
    const type = text(row["交易類型"]);
    const market = text(row["市場"]);
    const ticker = normalizeTicker(text(row["標的"]));
    const tickerKeyValue = normalizeTickerKey(ticker);
    const price = number(row["成交單價"]);
    const qty = number(row["股數"]);
    const fee = ensureFee(row);
    const other = number(row["匯費／其他費用"]);
    const rebate = number(row["折讓金額"]);
    const divP = number(row["配息單價"]);
    const divQ = number(row["配息股數"]);
    const fx = market === "美股" ? number(row["美元匯率"]) || liveFx : 1;
    const usd = market === "美股" ? calcTradeUsdAmount(type, price, qty, fee, other, rebate, divP, divQ) : "";
    const net = calcTradeTwdNet(market, type, price, qty, fee, other, rebate, divP, divQ, fx);

    row["標的"] = ticker;
    row["手續費／稅金"] = fee || row["手續費／稅金"] || 0;
    row["美元"] = usd;
    row["美元匯率"] = market === "美股" && ["買入", "賣出", "配息"].includes(type) ? fx : row["美元匯率"];
    row["即時匯率"] = market === "美股" ? liveFx : row["即時匯率"];
    row["配息金額"] = type === "配息" ? round0(market === "美股" ? number(usd) * fx : divP * divQ - other) : row["配息金額"];
    row["淨收支"] = net;
    row["已實現損益"] = "";
    row["賣出報酬率"] = "";
    row["剩餘成本"] = "";
    row["剩餘股數"] = "";

    if (type === "買入") {
      const id = text(row["買入編號"]);
      if (!id || qty <= 0) return;
      const cost = type === "結轉" ? Math.abs(number(row["剩餘成本"]) || number(row["淨收支"]) || price * qty * fx) : -number(net);
      batches.set(id, {
        id,
        market,
        ticker,
        tickerKey: tickerKeyValue,
        row,
        remQty: qty,
        remCost: Math.max(0, cost),
        lastBuyDate: parseDate(row["日期"]),
      });
      return;
    }

    if (type === "分割") {
      const ratio = number(row["分割比例"]);
      const splitDate = parseDate(row["日期"]) || new Date();
      const splitTime = splitDate.getTime();
      const splitPx = number(row["分割當天股價"]);
      const splitPxTwd = market === "美股" ? splitPx * (fx || DEFAULT_FX) : splitPx;
      let totalQtyBefore = 0;
      let totalCost = 0;
      const carryLines = [];
      const sourceIds = [];

      batches.forEach((batch, id) => {
        const buyTime = batch.lastBuyDate ? batch.lastBuyDate.getTime() : 0;
        if (batch.tickerKey !== tickerKeyValue || batch.remQty <= 0 || buyTime > splitTime) return;
        const qtyBefore = batch.remQty;
        const qtyAfter = qtyBefore * ratio;
        const costBefore = batch.remCost;
        const pnl = splitPxTwd > 0 ? splitPxTwd * qtyAfter - costBefore : 0;
        carryLines.push(`${id}｜${formatInt(qtyBefore)}股→${formatInt(qtyAfter)}股${splitPxTwd > 0 ? `｜分割時損益 ${formatMoneySigned(pnl)}` : ""}`);
        totalQtyBefore += qtyBefore;
        totalCost += costBefore;
        sourceIds.push(id);
        splitSourceIds.add(id);
        batch.remQty = 0;
        batch.remCost = 0;
      });

      if (totalQtyBefore > 0) {
        const carryId = makeSplitCarryId(ticker, splitDate);
        let carryRow = working.find((item) => text(item["買入編號"]) === carryId);
        if (!carryRow) {
          carryRow = {
            "表單列數": `local-carry-${Date.now()}`,
            "來源": "PWA",
            "狀態": "結轉",
            "日期": dateKey(splitDate),
            "市場": market,
            "標的": ticker,
            "交易類型": "結轉",
            "買入編號": carryId,
            "成交單價": totalCost / (totalQtyBefore * ratio),
            "股數": totalQtyBefore * ratio,
            "股票現價": priceByKey.get(stockKey(market, ticker))?.price || price,
          };
          working.push(carryRow);
        }
        carryRow["損益細項"] = carryLines.join("\n");
        carryRow["成交單價"] = totalCost / (totalQtyBefore * ratio);
        carryRow["股數"] = totalQtyBefore * ratio;
        carryRow["股票現價"] = priceByKey.get(stockKey(market, ticker))?.price || number(carryRow["股票現價"]) || price;
        batches.set(carryId, {
          id: carryId,
          market,
          ticker,
          tickerKey: tickerKeyValue,
          row: carryRow,
          remQty: totalQtyBefore * ratio,
          remCost: totalCost,
          lastBuyDate: splitDate,
        });
      }
      return;
    }

    if (type === "賣出") {
      const items = parseSellSpec(row["賣出編號"]);
      let totalCostRemoved = 0;
      items.forEach((item) => {
        const batch = batches.get(item.id);
        if (!batch || batch.remQty <= 0) return;
        const sellQty = item.qty === null ? batch.remQty : item.qty;
        const costRemoved = batch.remQty ? (batch.remCost / batch.remQty) * sellQty : 0;
        batch.remQty -= sellQty;
        batch.remCost -= costRemoved;
        totalCostRemoved += costRemoved;
      });
      row["已實現損益"] = number(net) - totalCostRemoved;
      row["賣出報酬率"] = totalCostRemoved ? number(row["已實現損益"]) / totalCostRemoved : 0;
    }
  });

  batches.forEach((batch) => {
    const row = batch.row;
    const priceInfo = priceByKey.get(stockKey(batch.market, batch.ticker)) || {};
    const currentPrice = number(row["股票現價"]) || priceInfo.price || number(row["成交單價"]);
    const fx = batch.market === "美股" ? liveFx : 1;
    const remCost = Math.max(0, batch.remCost);
    row["剩餘股數"] = roundQty(batch.remQty);
    row["剩餘成本"] = batch.remQty > 0 ? -remCost : "";
    row["股票現價"] = currentPrice;
    row["未實現損益"] = batch.remQty > 0 ? Math.trunc(currentPrice * batch.remQty * fx) - remCost : "";
    row["未實現報酬率"] = remCost ? number(row["未實現損益"]) / remCost : "";
  });

  working.forEach((row) => {
    const type = text(row["交易類型"]);
    if (type === "配息") row["狀態"] = "股利";
    if (type === "賣出") row["狀態"] = "已實現";
    if (type === "分割") row["狀態"] = "分割";
    if (type === "結轉") row["狀態"] = "結轉";
    if (type === "買入") {
      const id = text(row["買入編號"]);
      if (splitSourceIds.has(id)) {
        row["狀態"] = "已分割";
        row["剩餘股數"] = "";
        row["剩餘成本"] = "";
        row["未實現損益"] = "";
        row["未實現報酬率"] = "";
        return;
      }
      const remQty = number(row["剩餘股數"]);
      const origQty = number(row["股數"]);
      const hasRemCost = Math.abs(number(row["剩餘成本"])) > 1;
      if (!id || !(origQty > 0)) row["狀態"] = "⚠️異常";
      else if (remQty < -1e-9 || remQty > origQty + 1e-9) row["狀態"] = "⚠️異常";
      else if (Math.abs(remQty - origQty) <= 1e-9) row["狀態"] = "未實現";
      else if (remQty <= 1e-9 && !hasRemCost) row["狀態"] = "已實現";
      else row["狀態"] = "部分實現";
    }
  });

  return working.sort(compareDisplay);
}

function buildStockSummary(transactions, previousStocks, liveFx) {
  const prevByKey = new Map(previousStocks.map((stock) => [stockKey(stock["市場"], stock["標的"]), stock]));
  const groups = new Map();

  transactions.forEach((tx) => {
    const market = text(tx["市場"]);
    const ticker = normalizeTicker(text(tx["標的"]));
    if (!market || !ticker) return;
    const key = stockKey(market, ticker);
    if (!groups.has(key)) {
      const prev = prevByKey.get(key) || {};
      groups.set(key, {
        market,
        ticker,
        name: prev["名稱"] || ticker,
        price: number(tx["股票現價"]) || number(prev["股票現價"]),
        qty: 0,
        cost: 0,
        todayPnl: number(prev["今日損益"]),
        totalDiv: 0,
        feeRebate: 0,
        realizedPnl: 0,
        buyQty: 0,
        sellQty: 0,
        buyNet: 0,
        sellNet: 0,
        buyUsd: 0,
        hasLocalActivity: false,
      });
    }
    const group = groups.get(key);
    group.hasLocalActivity = group.hasLocalActivity || isLocalRow(tx);
    if (number(tx["股票現價"])) group.price = number(tx["股票現價"]);
    group.qty += number(tx["剩餘股數"]);
    group.cost += Math.abs(number(tx["剩餘成本"]));
    group.totalDiv += number(tx["配息金額"]);
    group.feeRebate += number(tx["折讓金額"]);
    group.realizedPnl += number(tx["已實現損益"]);
    if (text(tx["交易類型"]) === "買入") {
      group.buyQty += number(tx["股數"]);
      group.buyNet += number(tx["淨收支"]);
      group.buyUsd += number(tx["美元"]);
    }
    if (text(tx["交易類型"]) === "賣出") {
      group.sellQty += number(tx["股數"]);
      group.sellNet += number(tx["淨收支"]);
    }
  });

  const active = [...groups.values()].map((group) => {
    const fx = group.market === "美股" ? liveFx : 1;
    const value = Math.trunc(group.qty * group.price * fx);
    const unrealizedPnl = value - group.cost;
    const realizedWithIncome = group.realizedPnl + group.totalDiv + group.feeRebate;
    const totalReturn = unrealizedPnl + realizedWithIncome;
    const avgBuyFx = group.market === "美股" && group.buyUsd
      ? Math.abs(group.buyNet) / Math.abs(group.buyUsd)
      : fx;
    const tradeAvg = group.qty
      ? (group.market === "美股" ? (group.cost / group.qty) / (avgBuyFx || fx || DEFAULT_FX) : group.cost / group.qty)
      : 0;
    const costAvg = group.qty ? ((group.cost - group.totalDiv - group.feeRebate) / group.qty) / fx : 0;
    const breakEven = group.qty
      ? (group.market === "美股"
        ? (group.cost - group.totalDiv) / group.qty / fx
        : (group.cost * 1.0034 - group.totalDiv) / group.qty)
      : 0;
    const realizedDenominator = Math.abs(group.buyNet * safeRatio(group.sellQty, group.buyQty));
    const realizedRate = safeRatio(realizedWithIncome, realizedDenominator);
    const totalRateDenominator = group.cost + (Math.abs(group.sellNet) - group.realizedPnl);
    const totalRate = safeRatio(totalReturn, totalRateDenominator);
    return {
      "市場": group.market,
      "標的": group.ticker,
      "名稱": group.name,
      "持有成本": round0(group.cost),
      "庫存股數": roundQty(group.qty),
      "股票現價": group.price,
      "目前市值": value,
      "今日損益": round0(group.todayPnl),
      "累計配息": round0(group.totalDiv),
      "手續費折讓": round0(group.feeRebate),
      "成交均價": tradeAvg,
      "成本均價": costAvg,
      "損益平衡價": breakEven,
      "匯率損益_台幣": "",
      "股價損益_美元": "",
      "未實現損益": round0(unrealizedPnl),
      "未實現報酬率": group.cost ? unrealizedPnl / group.cost : 0,
      "已實現損益(含息)": round0(realizedWithIncome),
      "已實現報酬率(含息)": realizedRate,
      "總損益(含息)": round0(totalReturn),
      "總報酬率(含息)": totalRate,
      "股票佔比": "0%",
    };
  }).filter((row) => number(row["庫存股數"]) > 0 || number(row["已實現損益(含息)"]) || number(row["累計配息"]));

  const totalValue = active.reduce((sum, row) => sum + number(row["目前市值"]), 0);
  active.forEach((row) => {
    row["股票佔比"] = totalValue ? `${((number(row["目前市值"]) / totalValue) * 100).toFixed(2)}%` : "0%";
  });

  return active.sort((a, b) => number(b["目前市值"]) - number(a["目前市值"]));
}

function rebuildOverview(rows, stocks) {
  const twValue = sumStocks(stocks, "台股", "目前市值");
  const usValue = sumStocks(stocks, "美股", "目前市值");
  const twCost = sumStocks(stocks, "台股", "持有成本");
  const usCost = sumStocks(stocks, "美股", "持有成本");
  const next = rows.map((row) => ({ ...row }));
  let currentCat = "";
  let total = 0;

  next.forEach((row) => {
    if (text(row["大類別"])) currentCat = text(row["大類別"]);
    const sub = text(row["子項目"]);
    if (sub === "台股") {
      row["金額 (TWD)"] = twValue;
      row["成本"] = twCost;
    } else if (sub === "美股") {
      row["金額 (TWD)"] = usValue;
      row["成本"] = usCost;
    }
    if (text(row["大類別"]) === "總計") return;
    const value = number(row["金額 (TWD)"]);
    total += currentCat.includes("負債") ? -Math.abs(value) : value;
  });

  const totalRow = next.find((row) => text(row["大類別"]) === "總計");
  if (totalRow) totalRow["金額 (TWD)"] = round0(total);
  else next.push({ "大類別": "總計", "子項目": "", "金額 (TWD)": round0(total), "佔比 (%)": 1, "備註": "淨資產" });

  next.forEach((row) => {
    if (text(row["大類別"]) === "總計") {
      row["佔比 (%)"] = 1;
    } else {
      row["佔比 (%)"] = total ? Math.abs(number(row["金額 (TWD)"])) / Math.abs(total) : 0;
    }
  });
  return next;
}

function upsertTodaySnapshot(rows, overview, transactions, now) {
  const values = readOverviewValues(overview);
  const effective = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const targetKey = dateKey(effective);
  const normalized = rows.map((row) => ({ ...row }));
  const previous = normalized
    .filter((row) => dateKey(parseDate(row["日期"])) < targetKey && number(row["淨資產"]))
    .sort((a, b) => parseDate(b["日期"]) - parseDate(a["日期"]))[0];
  const first = normalized
    .filter((row) => number(row["淨資產"]))
    .sort((a, b) => parseDate(a["日期"]) - parseDate(b["日期"]))[0];
  const flows = buildInvestmentFlowsByDate(transactions).get(targetKey) || emptyInvestmentFlow();
  const twPnl = previous ? round0(values.tw - number(previous["台股"]) - flows.tw.buy + flows.tw.sell + flows.tw.income) : 0;
  const usPnl = previous ? round0(values.us - number(previous["美股"]) - flows.us.buy + flows.us.sell + flows.us.income) : 0;
  const cashPnl = previous ? round0(values.cash - number(previous["流動資金"])) : 0;
  const stockPnl = twPnl + usPnl;
  const previousInvestment = previous ? number(previous["台股"]) + number(previous["美股"]) : 0;
  const row = {
    "日期": targetKey,
    "快照時間": now.toISOString(),
    "淨資產": round0(values.netWorth),
    "台股": round0(values.tw),
    "美股": round0(values.us),
    "流動資金": round0(values.cash),
    "台股占比": safeRatio(values.tw, values.netWorth),
    "美股占比": safeRatio(values.us, values.netWorth),
    "流動資金占比": safeRatio(values.cash, values.netWorth),
    "每日損益": stockPnl,
    "每日報酬率": previous ? safeRatio(stockPnl, previousInvestment) : 0,
    "台股每日損益": twPnl,
    "台股每日報酬率": previous ? safeRatio(twPnl, number(previous["台股"])) : 0,
    "美股每日損益": usPnl,
    "美股每日報酬率": previous ? safeRatio(usPnl, number(previous["美股"])) : 0,
    "流動資金收支": cashPnl,
    "流動資金收支率": previous ? safeRatio(cashPnl, number(previous["流動資金"])) : 0,
    "累積報酬率": first ? safeRatio(values.netWorth, number(first["淨資產"])) - 1 : 0,
  };

  const withoutTarget = normalized.filter((item) => dateKey(parseDate(item["日期"])) !== targetKey);
  return [row, ...withoutTarget].sort((a, b) => parseDate(b["日期"]) - parseDate(a["日期"]));
}

function readOverviewValues(rows) {
  let currentCat = "";
  let netWorth = 0;
  let tw = 0;
  let us = 0;
  let cash = 0;
  rows.forEach((row) => {
    const cat = text(row["大類別"]);
    const sub = text(row["子項目"]);
    const value = number(row["金額 (TWD)"]);
    if (cat) currentCat = cat;
    if (cat === "總計") netWorth = value;
    if (sub === "台股") tw = value;
    if (sub === "美股") us = value;
    if (currentCat.includes("流動資金") && sub) cash += value;
  });
  return { netWorth, tw, us, cash };
}

function rebuildHistoricalTables(transactions, dailyPrices, existingSnapshots, overview, now) {
  const chronological = [...transactions].sort(compareHistoricalChronological);
  const start = chronological.map((row) => parseDate(row["日期"])).filter(Boolean).sort((a, b) => a - b)[0];
  if (!start) {
    return { dailyHoldings: [], dailyAssetSnapshots: existingSnapshots || [] };
  }

  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const txByDate = groupRowsByDate(chronological);
  const priceMap = buildDailyPriceMap(dailyPrices);
  const cashByDate = buildCashSourceMap(existingSnapshots);
  const overviewCash = readOverviewValues(overview).cash;
  const endKey = dateKey(end);
  if (!cashByDate.has(endKey) && overviewCash > 0) cashByDate.set(endKey, overviewCash);

  const lots = [];
  const holdingRows = [];
  const snapshotRows = [];
  let prevTw = null;
  let prevUs = null;
  let prevInvestment = null;
  let prevCash = null;
  let firstInvestment = null;

  for (const day of dateRange(start, end)) {
    const key = dateKey(day);
    const dayTransactions = txByDate.get(key) || [];
    dayTransactions.forEach((row) => applyHistoricalTransaction(row, lots));

    const dailyHoldings = historicalHoldingsSnapshot(key, lots);
    holdingRows.push(...dailyHoldings);

    let twValue = 0;
    let usValue = 0;
    dailyHoldings.forEach((holding) => {
      const price = priceMap.get(historicalKey(key, holding["市場"], holding["股票代號"]));
      if (!price || !(price.closeTwd > 0)) return;
      const value = Math.floor(number(holding["持股股數"]) * price.closeTwd);
      if (holding["市場"] === "台股") twValue += value;
      if (holding["市場"] === "美股") usValue += value;
    });

    const flows = investmentFlowsForRows(dayTransactions);
    const investmentValue = twValue + usValue;
    let cash = cashByDate.has(key) ? cashByDate.get(key) : null;
    if (cash === null && prevCash !== null) {
      cash = prevCash - flows.tw.buy - flows.us.buy + flows.tw.sell + flows.us.sell + flows.tw.income + flows.us.income;
    }
    const netWorth = cash === null ? "" : cash + investmentValue;
    const twPnl = prevTw === null ? "" : twValue - prevTw - flows.tw.buy + flows.tw.sell + flows.tw.income;
    const usPnl = prevUs === null ? "" : usValue - prevUs - flows.us.buy + flows.us.sell + flows.us.income;
    const stockPnl = twPnl === "" || usPnl === "" ? "" : twPnl + usPnl;
    if (firstInvestment === null && investmentValue > 0) firstInvestment = investmentValue;

    snapshotRows.push({
      "日期": key,
      "流動資金": cash === null ? "" : round0(cash),
      "台股市值": round0(twValue),
      "美股市值": round0(usValue),
      "投資總市值": round0(investmentValue),
      "淨資產": cash === null ? "" : round0(netWorth),
      "台股占比": netWorth ? safeRatio(twValue, netWorth) : safeRatio(twValue, investmentValue),
      "美股占比": netWorth ? safeRatio(usValue, netWorth) : safeRatio(usValue, investmentValue),
      "流動資金占比": netWorth ? safeRatio(cash, netWorth) : "",
      "每日損益": stockPnl,
      "每日報酬率": prevInvestment && stockPnl !== "" ? safeRatio(stockPnl, prevInvestment) : "",
      "台股每日損益": twPnl,
      "台股每日報酬率": prevTw ? safeRatio(twPnl, prevTw) : "",
      "美股每日損益": usPnl,
      "美股每日報酬率": prevUs ? safeRatio(usPnl, prevUs) : "",
      "累積報酬率": firstInvestment ? investmentValue / firstInvestment - 1 : "",
    });

    if (cash !== null) prevCash = cash;
    prevTw = twValue;
    prevUs = usValue;
    prevInvestment = investmentValue;
  }

  return {
    dailyHoldings: holdingRows,
    dailyAssetSnapshots: snapshotRows,
  };
}

function groupRowsByDate(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = dateKey(parseDate(row["日期"]));
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function buildDailyPriceMap(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const day = text(row["日期"] || row.date).slice(0, 10);
    const market = text(row["市場"] || row.market);
    const ticker = normalizeTicker(text(row["股票代號"] ?? row.ticker));
    if (!day || !market || !ticker) return;
    map.set(historicalKey(day, market, ticker), {
      closeTwd: number(row["台幣收盤價"] ?? row.closeTwd),
      close: number(row["收盤價"] ?? row.close),
    });
  });
  return map;
}

function buildCashSourceMap(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = dateKey(parseDate(row["日期"] || row.date));
    const value = number(row["流動資金"] ?? row.cash);
    if (key && value) map.set(key, value);
  });
  return map;
}

function applyHistoricalTransaction(row, lots) {
  const type = text(row["交易類型"]);
  if (type === "買入" || type === "結轉") {
    const shares = number(row["股數"]);
    if (!(shares > 0)) return;
    const market = text(row["市場"]);
    const ticker = normalizeTicker(text(row["標的"]));
    if (type === "結轉") {
      for (let i = lots.length - 1; i >= 0; i--) {
        if (lots[i].market === market && lots[i].ticker === ticker) lots.splice(i, 1);
      }
    }
    const net = number(row["淨收支"]);
    const cost = Math.abs(number(row["剩餘成本"]) || net || historicalTransactionCashFlow(row));
    lots.push({
      id: text(row["買入編號"]) || `LOCAL-${dateKey(parseDate(row["日期"]))}-${text(row["標的"])}`,
      market,
      ticker,
      shares,
      cost,
      currency: "TWD",
    });
    return;
  }

  if (type === "賣出") {
    let remaining = number(row["股數"]);
    const sellItems = parseSellSpec(row["賣出編號"]);
    const candidates = lots.filter((lot) => {
      if (lot.market !== text(row["市場"]) || lot.ticker !== normalizeTicker(text(row["標的"])) || lot.shares <= 0) return false;
      return !sellItems.length || sellItems.some((item) => item.id === lot.id);
    });
    candidates.forEach((lot) => {
      if (remaining <= 1e-9) return;
      const matched = sellItems.find((item) => item.id === lot.id);
      const requested = matched?.qty ?? remaining;
      const used = Math.min(lot.shares, requested, remaining);
      const ratio = lot.shares ? used / lot.shares : 0;
      lot.shares -= used;
      lot.cost *= 1 - ratio;
      remaining -= used;
    });
    for (let i = lots.length - 1; i >= 0; i--) {
      if (lots[i].shares <= 1e-9) lots.splice(i, 1);
    }
    return;
  }

  if (type === "分割") {
    const ratio = number(row["分割比例"]);
    if (!(ratio > 0)) return;
    const market = text(row["市場"]);
    const ticker = normalizeTicker(text(row["標的"]));
    lots.forEach((lot) => {
      if (lot.market === market && lot.ticker === ticker) lot.shares *= ratio;
    });
  }
}

function historicalHoldingsSnapshot(key, lots) {
  const grouped = new Map();
  lots.forEach((lot) => {
    if (!(lot.shares > 1e-9)) return;
    const groupKey = `${lot.market}|${lot.ticker}|${lot.currency}`;
    const group = grouped.get(groupKey) || {
      "日期": key,
      "市場": lot.market,
      "股票代號": lot.ticker,
      "持股股數": 0,
      "平均成本": 0,
      "成本總額": 0,
      "幣別": lot.currency,
    };
    group["持股股數"] += lot.shares;
    group["成本總額"] += lot.cost;
    grouped.set(groupKey, group);
  });
  return [...grouped.values()].map((row) => ({
    ...row,
    "持股股數": roundQty(row["持股股數"]),
    "成本總額": round0(row["成本總額"]),
    "平均成本": row["持股股數"] ? row["成本總額"] / row["持股股數"] : 0,
  })).sort((a, b) => `${a["市場"]}${a["股票代號"]}`.localeCompare(`${b["市場"]}${b["股票代號"]}`));
}

function investmentFlowsForRows(rows) {
  const flow = emptyInvestmentFlow();
  rows.forEach((row) => {
    const market = text(row["市場"]) === "美股" ? "us" : text(row["市場"]) === "台股" ? "tw" : "";
    const type = text(row["交易類型"]);
    if (!market) return;
    const amount = Math.abs(historicalTransactionCashFlow(row));
    if (type === "買入") flow[market].buy += amount;
    if (type === "賣出") flow[market].sell += amount;
    if (["配息", "股利"].includes(type)) flow[market].income += amount;
  });
  return flow;
}

function historicalTransactionCashFlow(row) {
  const net = number(row["淨收支"]);
  if (net) return net;
  return investmentFlowAmount(row) * (text(row["交易類型"]) === "買入" ? -1 : 1);
}

function buildInvestmentFlowsByDate(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const date = parseDate(row["日期"]);
    const market = text(row["市場"]) === "美股" ? "us" : text(row["市場"]) === "台股" ? "tw" : "";
    const type = text(row["交易類型"]);
    if (!date || !market) return;
    const key = dateKey(date);
    const flow = map.get(key) || emptyInvestmentFlow();
    const amount = investmentFlowAmount(row);
    if (type === "買入") flow[market].buy += amount;
    if (type === "賣出") flow[market].sell += amount;
    if (["配息", "股利"].includes(type)) flow[market].income += amount;
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

function investmentFlowAmount(row) {
  const type = text(row["交易類型"]);
  const net = Math.abs(number(row["淨收支"]));
  if (net) return net;
  if (["配息", "股利"].includes(type)) return Math.abs(number(row["配息金額"]) || number(row["配息單價"]) * number(row["配息股數"]));
  const fx = text(row["市場"]) === "美股" ? number(row["美元匯率"]) || 1 : 1;
  return Math.abs(number(row["成交單價"]) * number(row["股數"]) * fx + number(row["手續費／稅金"]) + number(row["匯費／其他費用"]));
}

function generateBuyIds(rows) {
  const counters = new Map();
  rows.forEach((row) => {
    const id = text(row["買入編號"]);
    const parts = id.split("-");
    if (parts.length < 3) return;
    const seq = number(parts.pop());
    const prefix = parts.join("-");
    if (seq > (counters.get(prefix) || 0)) counters.set(prefix, seq);
  });

  [...rows].sort(compareChronological).forEach((row) => {
    if (text(row["交易類型"]) !== "買入" || text(row["買入編號"])) return;
    const d = parseDate(row["日期"]) || new Date();
    const ticker = normalizeTicker(text(row["標的"]));
    const prefix = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${ticker}`;
    const seq = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, seq);
    row["買入編號"] = `${prefix}-${String(seq).padStart(2, "0")}`;
  });
}

function statusForBuyRow(row, batch) {
  const origQty = number(row["股數"]);
  if (batch.remQty <= 1e-9) return "已實現";
  if (Math.abs(batch.remQty - origQty) <= 1e-9) return "未實現";
  return "部分實現";
}

function statusForComputedBuy(row) {
  const remQty = number(row["剩餘股數"]);
  const qty = number(row["股數"]);
  if (remQty <= 1e-9) return "已實現";
  if (Math.abs(remQty - qty) <= 1e-9) return "未實現";
  return "部分實現";
}

function isLocalRow(row) {
  return text(row["表單列數"]).startsWith("local-") || text(row["來源"]) === "PWA";
}

function ensureFee(row) {
  const existing = row["手續費／稅金"];
  if (existing !== "" && existing !== null && existing !== undefined) return number(existing);
  const market = text(row["市場"]);
  const type = text(row["交易類型"]);
  if (market !== "台股" || !["買入", "賣出"].includes(type)) return 0;
  const broker = text(row["券商"]) || "永豐大戶";
  const rule = BROKER_RULES[broker] || BROKER_RULES["永豐大戶"];
  const discount = number(row["手續費折扣"]) || rule.defaultDiscount;
  return calcTwFeeFromDiscount(number(row["成交單價"]) * number(row["股數"]), type, discount, rule.minFee);
}

function calcTwFeeFromDiscount(amount, type, discount, minFee) {
  if (!(amount > 0) || !(discount > 0)) return 0;
  let fee = Math.round(amount * 0.001425 * (discount / 10));
  if (fee < minFee) fee = minFee;
  if (type === "賣出") fee += Math.round(amount * 0.003);
  return fee;
}

function calcTradeUsdAmount(type, price, qty, fee, other, rebate, divP, divQ) {
  if (type === "買入") return -(price * qty + fee + other - rebate);
  if (type === "賣出") return price * qty - fee - other + rebate;
  if (type === "配息") return divP * divQ - other;
  return "";
}

function calcTradeTwdNet(market, type, price, qty, fee, other, rebate, divP, divQ, fx) {
  if (type === "分割" || type === "結轉") return "";
  if (type === "折讓") return round0(rebate);
  if (market === "美股") {
    const usd = calcTradeUsdAmount(type, price, qty, fee, other, rebate, divP, divQ);
    return usd === "" ? 0 : round0(usd * (fx || DEFAULT_FX));
  }
  if (type === "買入") return round0(-(price * qty + fee + other - rebate));
  if (type === "賣出") return round0(price * qty - fee - other + rebate);
  if (type === "配息") return round0(divP * divQ - other);
  return 0;
}

function parseSellSpec(value) {
  return text(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [id, qty] = part.split(":").map((item) => item.trim());
      return { id, qty: qty ? number(qty) : null };
    });
}

function buildPriceMap(stocks, dailyPrices, liveFx) {
  const map = new Map(stocks.map((stock) => [
    stockKey(stock["市場"], stock["標的"]),
    { price: number(stock["股票現價"]), fx: text(stock["市場"]) === "美股" ? liveFx : 1 },
  ]));
  const latestByInstrument = new Map();
  dailyPrices.forEach((row) => {
    const day = text(row["日期"] || row.date).slice(0, 10);
    const market = text(row["市場"] || row.market);
    const ticker = normalizeTicker(text(row["股票代號"] ?? row.ticker));
    if (!day || !market || !ticker) return;
    const key = stockKey(market, ticker);
    const previous = latestByInstrument.get(key);
    if (!previous || day > previous.day) {
      latestByInstrument.set(key, {
        day,
        price: number(row["收盤價"] ?? row.close),
        fx: market === "美股" ? number(row["匯率"] ?? row.fx) || liveFx : 1,
      });
    }
  });
  latestByInstrument.forEach((priceInfo, key) => {
    if (priceInfo.price > 0) map.set(key, { price: priceInfo.price, fx: priceInfo.fx || liveFx || 1 });
  });
  return map;
}

function findLiveFx(transactions, stocks) {
  for (const row of transactions) {
    const fx = number(row["即時匯率"]) || number(row["美元匯率"]);
    if (fx) return fx;
  }
  for (const row of stocks) {
    const market = text(row["市場"]);
    if (market === "美股") return number(row["即時匯率"]);
  }
  return 0;
}

function sumStocks(stocks, market, field) {
  return round0(stocks.filter((stock) => text(stock["市場"]) === market).reduce((sum, stock) => sum + number(stock[field]), 0));
}

function compareChronological(a, b) {
  const ad = parseDate(a["日期"])?.getTime() || Number.POSITIVE_INFINITY;
  const bd = parseDate(b["日期"])?.getTime() || Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;
  return (parseDate(a["時間戳記"])?.getTime() || 0) - (parseDate(b["時間戳記"])?.getTime() || 0);
}

function compareHistoricalChronological(a, b) {
  const ad = parseDate(a["日期"])?.getTime() || Number.POSITIVE_INFINITY;
  const bd = parseDate(b["日期"])?.getTime() || Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;
  const rank = { "買入": 10, "賣出": 20, "配息": 30, "分割": 40, "結轉": 50 };
  const ar = rank[text(a["交易類型"])] || 99;
  const br = rank[text(b["交易類型"])] || 99;
  if (ar !== br) return ar - br;
  return (parseDate(a["時間戳記"])?.getTime() || 0) - (parseDate(b["時間戳記"])?.getTime() || 0);
}

function compareDisplay(a, b) {
  const ad = parseDate(a["日期"])?.getTime() || 0;
  const bd = parseDate(b["日期"])?.getTime() || 0;
  if (ad !== bd) return bd - ad;
  const ar = TYPE_RANK[text(a["交易類型"])] || 99;
  const br = TYPE_RANK[text(b["交易類型"])] || 99;
  if (ar !== br) return ar - br;
  return (parseDate(b["時間戳記"])?.getTime() || 0) - (parseDate(a["時間戳記"])?.getTime() || 0);
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

function dateRange(start, end) {
  const rows = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= last) {
    rows.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

function stockKey(market, ticker) {
  return `${text(market)}::${normalizeTicker(text(ticker))}`;
}

function historicalKey(date, market, ticker) {
  return `${text(date)}|${text(market)}|${normalizeTicker(text(ticker))}`;
}

function normalizeTicker(value) {
  const ticker = text(value).replace(/^'/, "");
  return TICKER_DISPLAY[ticker] || ticker;
}

function normalizeTickerKey(value) {
  const ticker = normalizeTicker(value);
  return TICKER_MAP[ticker] || ticker;
}

function makeSplitCarryId(ticker, date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `SPLIT-${y}${m}${d}-${normalizeTickerKey(ticker)}`;
}

function formatMoneySigned(value) {
  const n = Math.round(Number(value) || 0);
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toLocaleString("zh-TW", { maximumFractionDigits: 0 })}`;
}

function formatInt(value) {
  return (Number(value) || 0).toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

function safeRatio(value, base) {
  return base ? value / base : 0;
}

function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return Number(String(value || "").replace(/[,%"]/g, "").trim()) || 0;
}

function text(value) {
  return String(value ?? "").trim();
}

function round0(value) {
  return Math.round(Number(value) || 0);
}

function roundQty(value) {
  return Math.round((Number(value) || 0) * 100000) / 100000;
}
