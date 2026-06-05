 sub, tone = null) {
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
