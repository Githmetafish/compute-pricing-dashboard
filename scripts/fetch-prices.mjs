#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(readFileSync(`${rootDir}/config/sources.json`, "utf8"));
const outputPath = `${rootDir}/data/compute-pricing.json`;
const today = new Date().toISOString().slice(0, 10);

const args = new Set(process.argv.slice(2));
const selectedSources = getArgValue("--sources")
  ?.split(",")
  .map((source) => source.trim())
  .filter(Boolean);

function getArgValue(flag) {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(flag);
  if (index === -1) return "";
  return argv[index + 1] || "";
}

function normalize(row) {
  return {
    date: String(row.date || today).slice(0, 10),
    platform: String(row.platform || "").trim(),
    sku: String(row.sku || "").trim(),
    mode: String(row.mode || "unknown").trim(),
    price: Number(row.price),
    supply: Number(row.supply || 0),
    discount: Number(row.discount || 0),
    frequency: String(row.frequency || "daily").trim(),
  };
}

function isValid(row) {
  return row.date && row.platform && row.sku && Number.isFinite(row.price) && row.price >= 0;
}

function readRows(path) {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalize).filter(isValid);
}

function mergeRows(existing, incoming) {
  const byKey = new Map();
  for (const row of [...existing, ...incoming]) {
    byKey.set(`${row.date}|${row.platform}|${row.sku}|${row.mode}`, row);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.sku.localeCompare(b.sku) ||
      a.platform.localeCompare(b.platform) ||
      new Date(a.date) - new Date(b.date) ||
      a.mode.localeCompare(b.mode),
  );
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "compute-pricing-dashboard/1.0",
      accept: "text/html,application/json",
    },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function priceNear(text, label, windowSize = 700) {
  const index = text.indexOf(label);
  if (index === -1) return null;
  const fragment = text.slice(index, index + windowSize);
  const match = fragment.match(/\$(\d+(?:\.\d+)?)(?:\s*\/?\s*hr|\s*\/?\s*Hour)?/i);
  return match ? Number(match[1]) : null;
}

function systemPricesNear(text, label) {
  const index = text.indexOf(label);
  if (index === -1) return {};
  const fragment = text.slice(index, index + 650);
  const onDemand = fragment.match(/On-Demand Price:\s*\$(\d+(?:\.\d+)?)\s*\/\s*Hour/i);
  const spot = fragment.match(/Spot Price:\s*\$(\d+(?:\.\d+)?)\s*\/\s*Hour/i);
  const gpuCount = fragment.match(/(\d+)\s*GPU Count/i);
  return {
    onDemand: onDemand ? Number(onDemand[1]) : null,
    spot: spot ? Number(spot[1]) : null,
    gpuCount: gpuCount ? Number(gpuCount[1]) : 8,
  };
}

async function fetchRunPod(source) {
  const text = stripHtml(await fetchText(source.url));
  const targets = [
    ["H100 SXM", "H100 SXM"],
    ["H100 NVL", "H100 NVL"],
    ["H200 SXM", "H200"],
    ["B200", "B200"],
  ];
  return targets
    .map(([sku, label]) => {
      const price = priceNear(text, label);
      if (price === null) return null;
      return normalize({
        platform: source.platform,
        sku,
        mode: "secure",
        price,
        supply: 0,
        discount: 0,
        frequency: source.frequency,
      });
    })
    .filter(Boolean);
}

async function fetchLambda(source) {
  const text = stripHtml(await fetchText(source.url));
  const targets = [
    ["H100 SXM", "NVIDIA H100 SXM"],
    ["B200", "NVIDIA B200 SXM6"],
  ];
  return targets
    .map(([sku, label]) => {
      const price = priceNear(text, label, 260);
      if (price === null) return null;
      return normalize({
        platform: source.platform,
        sku,
        mode: "on-demand",
        price,
        supply: 0,
        discount: 0,
        frequency: source.frequency,
      });
    })
    .filter(Boolean);
}

async function fetchCoreWeave(source) {
  const text = stripHtml(await fetchText(source.url));
  const targets = [
    ["H100 SXM", "NVIDIA HGX H100"],
    ["H200 SXM", "NVIDIA HGX H200"],
    ["B200", "NVIDIA HGX B200"],
  ];
  const rows = [];
  for (const [sku, label] of targets) {
    const prices = systemPricesNear(text, label);
    const count = prices.gpuCount || 8;
    if (prices.onDemand !== null) {
      rows.push(
        normalize({
          platform: source.platform,
          sku,
          mode: "on-demand",
          price: prices.onDemand / count,
          supply: 0,
          discount: 0,
          frequency: source.frequency,
        }),
      );
    }
    if (prices.spot !== null) {
      rows.push(
        normalize({
          platform: source.platform,
          sku,
          mode: "spot",
          price: prices.spot / count,
          supply: 0,
          discount: prices.onDemand ? 1 - prices.spot / prices.onDemand : 0,
          frequency: source.frequency,
        }),
      );
    }
  }
  return rows;
}

async function fetchVast(source) {
  const apiKey = process.env.VAST_API_KEY;
  if (!apiKey) {
    console.warn("skip vast: VAST_API_KEY is not set");
    return [];
  }

  const gpuNames = [
    ["H100 SXM", "H100 SXM"],
    ["H100 NVL", "H100 NVL"],
    ["H200 SXM", "H200"],
    ["B200", "B200"],
  ];
  const rows = [];

  for (const [sku, gpuName] of gpuNames) {
    const response = await fetch(source.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        verified: { eq: true },
        rentable: { eq: true },
        gpu_name: { eq: gpuName },
        order: [["dph_total", "asc"]],
        type: "on-demand",
        limit: 50,
      }),
    });
    if (!response.ok) throw new Error(`vast ${gpuName} returned ${response.status}`);
    const json = await response.json();
    const offers = json.offers || json.bundles || [];
    const perGpuPrices = offers
      .map((offer) => {
        const total = Number(offer.dph_total ?? offer.discounted_dph_total ?? offer.min_bid);
        const gpuCount = Number(offer.num_gpus || offer.gpu_count || 1);
        return total && gpuCount ? total / gpuCount : null;
      })
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
    if (!perGpuPrices.length) continue;
    const p25 = perGpuPrices[Math.floor((perGpuPrices.length - 1) * 0.25)];
    rows.push(
      normalize({
        platform: source.platform,
        sku,
        mode: "market",
        price: p25,
        supply: perGpuPrices.length,
        discount: 0,
        frequency: source.frequency,
      }),
    );
  }

  return rows;
}

async function fetchGcpSpot(source) {
  const url = process.env[source.remoteEnv];
  if (url) {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return (await response.json()).map((row) =>
      normalize({
        ...row,
        platform: row.platform || source.platform,
        mode: row.mode || "spot",
        frequency: row.frequency || source.frequency,
      }),
    );
  }

  const manualPath = `${rootDir}/${source.inputFile}`;
  return readRows(manualPath).map((row) =>
    normalize({
      ...row,
      platform: row.platform || source.platform,
      mode: row.mode || "spot",
      frequency: row.frequency || source.frequency,
    }),
  );
}

const fetchers = {
  runpod: fetchRunPod,
  lambda: fetchLambda,
  coreweave: fetchCoreWeave,
  vast: fetchVast,
  gcpSpot: fetchGcpSpot,
};

async function main() {
  const sourceNames = selectedSources || Object.keys(fetchers);
  const latestRows = [];

  for (const name of sourceNames) {
    const source = config.sources[name];
    const fetcher = fetchers[name];
    if (!source || !fetcher) {
      console.warn(`skip ${name}: source is not configured`);
      continue;
    }
    try {
      const rows = (await fetcher(source)).filter(isValid);
      latestRows.push(...rows);
      console.log(`${name}: ${rows.length} rows`);
    } catch (error) {
      console.warn(`${name}: ${error.message}`);
    }
  }

  const existing = readRows(outputPath);
  if (!latestRows.length) {
    console.log("No new rows. Existing data left unchanged.");
    return;
  }

  const merged = mergeRows(existing, latestRows);
  writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`Wrote ${merged.length} rows to data/compute-pricing.json; ${latestRows.length} new rows for ${today}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(args.has("--soft-fail") ? 0 : 1);
});
