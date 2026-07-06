const DATA_URLS = ["./data/compute-pricing.json", "./sample-data.json"];
const SAMPLE_DATA_URL = "./sample-data.json";
const colors = ["#126d62", "#2f6fab", "#b65b0f", "#7d4ac7", "#157347", "#b42318"];
const skuProfiles = {
  "H100 SXM": {
    order: 10,
    role: "训练/HPC 口径",
    spec: "SXM 形态，80GB HBM3，高功耗高算力；不与 H100 NVL 混算。",
  },
  "H100 NVL": {
    order: 20,
    role: "LLM 推理口径",
    spec: "PCIe NVL 形态，94GB HBM3，面向大模型推理；价格不能直接等同 H100 SXM。",
  },
  "H200 SXM": {
    order: 30,
    role: "高显存训练/推理口径",
    spec: "H200 SXM 形态，显存容量和带宽高于 H100；单独观察，不并入 H100。",
  },
  B200: {
    order: 40,
    role: "Blackwell 新代际口径",
    spec: "B200 属于新一代 GPU，供需和定价周期与 H100/H200 分开看。",
  },
};

let records = [];
let state = {
  sku: "",
  platform: "全部平台",
  metric: "price",
};

const els = {
  latestDate: document.querySelector("#latestDate"),
  platformCount: document.querySelector("#platformCount"),
  skuCount: document.querySelector("#skuCount"),
  alertLevel: document.querySelector("#alertLevel"),
  skuTabs: document.querySelector("#skuTabs"),
  platformFilter: document.querySelector("#platformFilter"),
  metricMode: document.querySelector("#metricMode"),
  chartTitle: document.querySelector("#chartTitle"),
  chartLegend: document.querySelector("#chartLegend"),
  chart: document.querySelector("#trendChart"),
  skuRole: document.querySelector("#skuRole"),
  skuSpec: document.querySelector("#skuSpec"),
  signalList: document.querySelector("#signalList"),
  metricCards: document.querySelector("#metricCards"),
  snapshotTable: document.querySelector("#snapshotTable"),
  changeHeader: document.querySelector("#changeHeader"),
  dataFile: document.querySelector("#dataFile"),
  resetData: document.querySelector("#resetData"),
  downloadTemplate: document.querySelector("#downloadTemplate"),
};

const unique = (items) => [...new Set(items)];
const byDate = (a, b) => new Date(a.date) - new Date(b.date);
const bySkuOrder = (a, b) => (skuProfiles[a]?.order || 999) - (skuProfiles[b]?.order || 999) || a.localeCompare(b);
const fmtUsd = (n) => `$${Number(n).toFixed(2)}`;
const fmtPct = (n) => `${Math.round(Number(n) * 100)}%`;
const fmtChange = (n) => `${n > 0 ? "+" : ""}${Number(n).toFixed(1)}%`;
const dayMs = 24 * 60 * 60 * 1000;

function normalizeRecord(row) {
  return {
    date: String(row.date || "").slice(0, 10),
    platform: String(row.platform || "").trim(),
    sku: String(row.sku || "").trim(),
    mode: String(row.mode || "").trim() || "unknown",
    price: Number(row.price),
    supply: Number(row.supply || 0),
    discount: Number(row.discount || 0),
    frequency: String(row.frequency || "").trim() || "daily",
  };
}

async function loadSample() {
  const response = await fetch(SAMPLE_DATA_URL);
  records = (await response.json()).map(normalizeRecord).filter(isValidRecord);
  initState();
  render();
}

async function loadInitialData() {
  for (const url of DATA_URLS) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const parsed = (await response.json()).map(normalizeRecord).filter(isValidRecord);
      if (!parsed.length) continue;
      records = parsed;
      initState();
      render();
      return;
    } catch {
      // Try the next source.
    }
  }
  records = [];
  render();
}

function isValidRecord(row) {
  return row.date && row.platform && row.sku && Number.isFinite(row.price);
}

function initState() {
  const skus = unique(records.map((r) => r.sku));
  state.sku = state.sku && skus.includes(state.sku) ? state.sku : skus[0] || "";
  state.platform = "全部平台";
  state.metric = "price";
}

function render() {
  renderFilters();
  renderStatus();
  renderSkuContext();
  renderCards();
  renderSignals();
  renderChart();
  renderTable();
}

function renderFilters() {
  const skus = unique(records.map((r) => r.sku)).sort(bySkuOrder);
  els.skuTabs.innerHTML = skus
    .map((sku) => `<button type="button" class="${sku === state.sku ? "active" : ""}" data-sku="${sku}">${sku}</button>`)
    .join("");

  const platforms = ["全部平台", ...unique(records.filter((r) => r.sku === state.sku).map((r) => r.platform))];
  if (!platforms.includes(state.platform)) state.platform = "全部平台";
  els.platformFilter.innerHTML = platforms.map((p) => `<option ${p === state.platform ? "selected" : ""}>${p}</option>`).join("");
  els.metricMode.value = state.metric;
}

function renderSkuContext() {
  const profile = skuProfiles[state.sku] || {
    role: "独立 SKU 口径",
    spec: "当前视图只比较完全相同的 SKU，不跨不同形态或不同代际合并。",
  };
  els.skuRole.textContent = profile.role;
  els.skuSpec.textContent = profile.spec;
}

function renderStatus() {
  const dates = records.map((r) => r.date).sort();
  const level = assessAlertLevel();
  els.latestDate.textContent = dates.at(-1) || "-";
  els.platformCount.textContent = unique(records.map((r) => r.platform)).length;
  els.skuCount.textContent = unique(records.map((r) => r.sku)).length;
  els.alertLevel.textContent = level.label;
  els.alertLevel.style.color = level.color;
}

function selectedRecords() {
  return records
    .filter((r) => r.sku === state.sku)
    .filter((r) => state.platform === "全部平台" || r.platform === state.platform)
    .sort(byDate);
}

function seriesKey(row) {
  return `${row.platform}::${row.mode}`;
}

function seriesLabel(row) {
  return row.mode === "unknown" ? row.platform : `${row.platform} ${row.mode}`;
}

function uniqueLatestRows(rows) {
  return unique(rows.map(seriesKey))
    .map((key) => rows.filter((r) => seriesKey(r) === key).sort(byDate).at(-1))
    .filter(Boolean);
}

function latestBySeries(sku = state.sku) {
  return uniqueLatestRows(records.filter((r) => r.sku === sku));
}

function dateValue(date) {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function windowedSeries(series, latestDate, days) {
  if (!latestDate) return [];
  const cutoff = dateValue(latestDate) - (days - 1) * dayMs;
  return series.filter((r) => dateValue(r.date) >= cutoff);
}

function firstLatestPair(row, days = 28) {
  const series = records
    .filter((r) => r.platform === row.platform && r.sku === row.sku && r.mode === row.mode)
    .sort(byDate);
  const latest = series.at(-1);
  const periodSeries = windowedSeries(series, latest?.date, days);
  return { first: periodSeries[0] || series[0], latest, series, periodSeries };
}

function historyDateCount(sku = state.sku) {
  return unique(records.filter((r) => r.sku === sku).map((r) => r.date)).length;
}

function trendLabel() {
  return historyDateCount() >= 28 ? "4周均价变化" : "样本期均价变化";
}

function trendWindowText() {
  return historyDateCount() >= 28 ? "4周价格" : "样本期价格";
}

function trendNote() {
  const days = historyDateCount();
  return days >= 28 ? "最近 28 天同一 SKU/模式口径下的价格变化" : `当前只有 ${days} 天真实数据，4周趋势需继续积累`;
}

function changePct(first, latest, key = "price") {
  if (!first || !latest || !first[key]) return 0;
  return ((latest[key] - first[key]) / first[key]) * 100;
}

function renderCards() {
  const latest = latestBySeries();
  const pairs = latest.map((r) => firstLatestPair(r));
  const avgPrice = latest.reduce((sum, r) => sum + r.price, 0) / Math.max(latest.length, 1);
  const avgChange = pairs.reduce((sum, p) => sum + changePct(p.first, p.latest), 0) / Math.max(pairs.length, 1);
  const totalSupply = latest.reduce((sum, r) => sum + r.supply, 0);
  const avgDiscount = latest.reduce((sum, r) => sum + r.discount, 0) / Math.max(latest.length, 1);

  const cards = [
    ["平均价格", fmtUsd(avgPrice), "当前 SKU 各平台/模式最新价均值，不跨 SXM/NVL 混算"],
    [trendLabel(), fmtChange(avgChange), trendNote()],
    ["可用 GPU", Math.round(totalSupply).toLocaleString("en-US"), "最新横截面供给数量合计"],
    ["平均 Spot 折扣", fmtPct(avgDiscount), "折扣扩大通常先于 list price 变化"],
  ];

  els.metricCards.innerHTML = cards
    .map(([label, value, note]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><em>${note}</em></article>`)
    .join("");
}

function assessAlertLevel() {
  const skus = unique(records.map((r) => r.sku));
  let weakSeriesCount = 0;
  let weakSkuCount = 0;

  skus.forEach((sku) => {
    const latest = latestBySeries(sku);
    const weak = latest.filter((row) => {
      const pair = firstLatestPair(row);
      return changePct(pair.first, pair.latest) <= -10 && changePct(pair.first, pair.latest, "supply") >= 10;
    });
    weakSeriesCount += weak.length;
    if (weak.length >= 2) weakSkuCount += 1;
  });

  if (weakSkuCount >= 2) return { label: "中度预警", color: "var(--warning)", weakSeriesCount, weakSkuCount };
  if (weakSeriesCount >= 2) return { label: "轻度预警", color: "var(--warning)", weakSeriesCount, weakSkuCount };
  return { label: "正常观察", color: "var(--ok)", weakSeriesCount, weakSkuCount };
}

function renderSignals() {
  const latest = latestBySeries();
  const pairRows = latest.map((r) => {
    const pair = firstLatestPair(r);
    return {
      ...r,
      priceChange: changePct(pair.first, pair.latest),
      supplyChange: changePct(pair.first, pair.latest, "supply"),
    };
  });

  const weak = pairRows.filter((r) => r.priceChange <= -10 && r.supplyChange >= 10);
  const mild = pairRows.filter((r) => r.priceChange < 0 && r.supplyChange > 0 && r.priceChange > -10);
  const stable = pairRows.filter((r) => r.priceChange >= 0 || r.supplyChange <= 0);
  const level = assessAlertLevel();

  const items = [
    {
      title: `${level.label}：价格与供给共振`,
      body: weak.length
        ? `${weak.map(seriesLabel).join("、")} 出现价格下跌超过 10% 且供给增加，需要继续观察是否扩散到 Lambda/CoreWeave。`
        : `当前样本没有达到“${trendWindowText()}下跌超过10%且供给增加”的平台组合。`,
      cls: weak.length ? "warning" : "",
    },
    {
      title: "轻微走弱平台",
      body: mild.length
        ? `${mild.map((r) => `${seriesLabel(r)} ${fmtChange(r.priceChange)}`).join("，")}。这属于观察信号，暂不单独升级。`
        : "当前 SKU 未出现明显轻微走弱平台。",
      cls: mild.length ? "warning" : "",
    },
    {
      title: "粘性价格平台",
      body: stable.length
        ? `${stable.map(seriesLabel).join("、")} 价格相对稳定或供给没有同步增加。公开 list price 通常滞后，不能据此排除风险。`
        : "所有平台都出现下跌与供给增加，需要提高风险权重。",
      cls: stable.length ? "" : "danger",
    },
  ];

  els.signalList.innerHTML = items
    .map((item) => `<div class="signal-item ${item.cls}"><strong>${item.title}</strong><p>${item.body}</p></div>`)
    .join("");
}

function renderChart() {
  const metricLabels = {
    price: "价格趋势",
    supply: "可用供给",
    discount: "折扣率",
  };
  els.chartTitle.textContent = `${state.sku} ${metricLabels[state.metric]}`;

  const data = selectedRecords();
  const seriesRows = uniqueLatestRows(data).sort((a, b) => a.platform.localeCompare(b.platform) || a.mode.localeCompare(b.mode));
  els.chartLegend.innerHTML = seriesRows
    .map((row, index) => `<span><i style="background:${colors[index % colors.length]}"></i>${seriesLabel(row)}</span>`)
    .join("");

  const width = 920;
  const height = 360;
  const margin = { top: 18, right: 24, bottom: 42, left: 58 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const dates = unique(data.map((r) => r.date)).sort();
  const values = data.map((r) => r[state.metric]);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const pad = (maxValue - minValue || 1) * 0.12;
  const yMin = Math.max(0, minValue - pad);
  const yMax = maxValue + pad;
  const x = (date) => margin.left + (dates.indexOf(date) / Math.max(dates.length - 1, 1)) * innerW;
  const y = (value) => margin.top + innerH - ((value - yMin) / Math.max(yMax - yMin, 1)) * innerH;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const yy = margin.top + ratio * innerH;
      const value = yMax - ratio * (yMax - yMin);
      const label = state.metric === "discount" ? fmtPct(value) : state.metric === "price" ? fmtUsd(value) : Math.round(value);
      return `<line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${yy}" y2="${yy}"></line>
        <text class="axis-label" x="${margin.left - 10}" y="${yy + 4}" text-anchor="end">${label}</text>`;
    })
    .join("");

  const xLabels = dates
    .map((date) => `<text class="axis-label" x="${x(date)}" y="${height - 12}" text-anchor="middle">${date.slice(5)}</text>`)
    .join("");

  const lines = seriesRows
    .map((row, index) => {
      const series = data.filter((r) => r.platform === row.platform && r.mode === row.mode).sort(byDate);
      const points = series.map((r) => `${x(r.date)},${y(r[state.metric])}`).join(" ");
      const circles = series
        .map((r) => `<circle class="point" cx="${x(r.date)}" cy="${y(r[state.metric])}" r="4" fill="${colors[index % colors.length]}"></circle>`)
        .join("");
      return `<polyline class="line-path" points="${points}" stroke="${colors[index % colors.length]}"></polyline>${circles}`;
    })
    .join("");

  els.chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  els.chart.innerHTML = `
    ${grid}
    <line class="axis" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}"></line>
    <line class="axis" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"></line>
    ${xLabels}
    ${lines}
  `;
}

function movingAverage(items, key, days = 7) {
  const latest = items.at(-1);
  const slice = windowedSeries(items, latest?.date, days);
  const value = slice.reduce((sum, r) => sum + r[key], 0) / Math.max(slice.length, 1);
  return value || 0;
}

function renderTable() {
  if (els.changeHeader) els.changeHeader.textContent = historyDateCount() >= 28 ? "4周变化" : "样本期变化";

  const rows = latestBySeries()
    .map((row) => {
      const pair = firstLatestPair(row);
      return {
        ...row,
        avg7d: movingAverage(pair.series, "price"),
        priceChange: changePct(pair.first, pair.latest),
      };
    })
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.mode.localeCompare(b.mode));

  els.snapshotTable.innerHTML = rows
    .map((r) => {
      const cls = r.priceChange < 0 ? "change-down" : r.priceChange > 0 ? "change-up" : "";
      return `<tr>
        <td>${r.platform}</td>
        <td>${r.sku}</td>
        <td>${r.mode}</td>
        <td>${fmtUsd(r.price)}</td>
        <td>${fmtUsd(r.avg7d)}</td>
        <td class="${cls}">${fmtChange(r.priceChange)}</td>
        <td>${Math.round(r.supply).toLocaleString("en-US")}</td>
        <td>${fmtPct(r.discount)}</td>
        <td>${r.frequency}</td>
      </tr>`;
    })
    .join("");
}

function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = rows.shift().split(",").map((h) => h.trim());
  return rows.map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    return headers.reduce((obj, key, index) => ({ ...obj, [key]: cells[index] }), {});
  });
}

function downloadTemplate() {
  const headers = ["date", "platform", "sku", "mode", "price", "supply", "discount", "frequency"];
  const example = ["2026-07-06", "GCP Spot", "H100 SXM", "spot", "3.62", "128", "0.59", "daily"];
  const blob = new Blob([`${headers.join(",")}\n${example.join(",")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "compute-pricing-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

els.skuTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-sku]");
  if (!button) return;
  state.sku = button.dataset.sku;
  state.platform = "全部平台";
  render();
});

els.platformFilter.addEventListener("change", (event) => {
  state.platform = event.target.value;
  render();
});

els.metricMode.addEventListener("change", (event) => {
  state.metric = event.target.value;
  render();
});

els.resetData.addEventListener("click", loadSample);
els.downloadTemplate.addEventListener("click", downloadTemplate);

els.dataFile.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  const rows = file.name.endsWith(".csv") ? parseCsv(text) : JSON.parse(text);
  const parsed = rows.map(normalizeRecord).filter(isValidRecord);
  if (!parsed.length) {
    window.alert("没有识别到有效数据。");
    return;
  }
  records = parsed;
  initState();
  render();
});

loadInitialData();
