#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

const requiredFields = ["date", "platform", "sku", "mode", "price", "supply", "discount", "frequency"];

function parseArgs(argv) {
  const args = { check: false, input: "", output: "data/compute-pricing.json" };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--check") args.check = true;
    else if (value === "--out") {
      args.output = argv[i + 1];
      i += 1;
    } else {
      rest.push(value);
    }
  }
  args.files = rest;
  return args;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines.shift().split(",").map((header) => header.trim());
  return lines.map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function parseFile(path) {
  const text = readFileSync(path, "utf8");
  if (extname(path).toLowerCase() === ".csv") return parseCsv(text);
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`${path} must contain a JSON array`);
  return parsed;
}

function normalize(row) {
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

function validate(row, index) {
  const missing = requiredFields.filter((field) => row[field] === "" || row[field] === undefined || row[field] === null);
  const problems = [];
  if (missing.length) problems.push(`missing ${missing.join("/")}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) problems.push("date must be YYYY-MM-DD");
  if (!Number.isFinite(row.price) || row.price < 0) problems.push("price must be a non-negative number");
  if (!Number.isFinite(row.supply) || row.supply < 0) problems.push("supply must be a non-negative number");
  if (!Number.isFinite(row.discount) || row.discount < 0 || row.discount > 1) problems.push("discount must be between 0 and 1");
  if (problems.length) return `row ${index + 1}: ${problems.join(", ")}`;
  return "";
}

function sortRows(a, b) {
  return (
    a.sku.localeCompare(b.sku) ||
    a.platform.localeCompare(b.platform) ||
    new Date(a.date) - new Date(b.date) ||
    a.mode.localeCompare(b.mode)
  );
}

const args = parseArgs(process.argv.slice(2));

if (!args.files.length) {
  console.error("Usage: node scripts/normalize-data.mjs [--check] [--out data/compute-pricing.json] input.json|input.csv [...]");
  process.exit(1);
}

const rows = args.files.flatMap(parseFile).map(normalize);
const errors = rows.map(validate).filter(Boolean);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

rows.sort(sortRows);

if (args.check) {
  console.log(`OK: ${rows.length} records`);
} else {
  writeFileSync(args.output, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`Wrote ${rows.length} records to ${args.output}`);
}
