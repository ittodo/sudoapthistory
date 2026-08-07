import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const indexPath = resolve(repoRoot, "data/index.json");
const pricesPath = resolve(repoRoot, "data/prices.json");
const outputPath = resolve(repoRoot, "data/price_bands.json");

const buckets = [
  { id: "lt5", label: "5억 미만", min: 0, max: 5 },
  { id: "5_10", label: "5~10억", min: 5, max: 10 },
  { id: "10_20", label: "10~20억", min: 10, max: 20 },
  { id: "20_30", label: "20~30억", min: 20, max: 30 },
  { id: "30_40", label: "30~40억", min: 30, max: 40 },
  { id: "40_50", label: "40~50억", min: 40, max: 50 },
  { id: "gte50", label: "50억 이상", min: 50, max: null },
];

const regionLabels = {
  0: "경기",
  1: "서울",
  2: "인천",
};

function bucketIndex(price) {
  if (!Number.isFinite(price) || price <= 0) return -1;
  for (let i = 0; i < buckets.length; i += 1) {
    const b = buckets[i];
    if (price >= b.min && (b.max == null || price < b.max)) return i;
  }
  return -1;
}

function emptyScope(type, label, parent = null) {
  return {
    type,
    label,
    parent,
    current: {
      units: 0,
      rows: 0,
      buckets: Array(buckets.length).fill(0),
      rowsByBucket: Array(buckets.length).fill(0),
    },
    trend: {
      unitsByYear: [],
      buckets: buckets.map(() => []),
    },
    coverage: {
      rows: 0,
      units: 0,
      missingUnitsRows: 0,
      missingCurrentPriceRows: 0,
      missingTrendPriceRowsByYear: [],
    },
  };
}

function ensureScope(scopes, key, type, label, parent = null, yearsLen = 0) {
  if (!scopes[key]) {
    const scope = emptyScope(type, label, parent);
    scope.trend.unitsByYear = Array(yearsLen).fill(0);
    scope.trend.buckets = buckets.map(() => Array(yearsLen).fill(0));
    scope.coverage.missingTrendPriceRowsByYear = Array(yearsLen).fill(0);
    scopes[key] = scope;
  }
  return scopes[key];
}

function addCurrent(scope, price, units) {
  const bi = bucketIndex(price);
  if (bi < 0) {
    scope.coverage.missingCurrentPriceRows += 1;
    return;
  }
  scope.current.units += units;
  scope.current.rows += 1;
  scope.current.buckets[bi] += units;
  scope.current.rowsByBucket[bi] += 1;
}

function addTrend(scope, priceArr, units, yearsLen) {
  for (let yi = 0; yi < yearsLen; yi += 1) {
    const price = Array.isArray(priceArr) ? Number(priceArr[yi] || 0) : 0;
    const bi = bucketIndex(price);
    if (bi < 0) {
      scope.coverage.missingTrendPriceRowsByYear[yi] += 1;
      continue;
    }
    scope.trend.unitsByYear[yi] += units;
    scope.trend.buckets[bi][yi] += units;
  }
}

function addRow(scope, row, priceArr, yearsLen) {
  const units = Number(row.u || 0);
  scope.coverage.rows += 1;
  if (!Number.isFinite(units) || units <= 0) {
    scope.coverage.missingUnitsRows += 1;
    return;
  }
  scope.coverage.units += units;
  addCurrent(scope, Number(row.lp || 0), units);
  addTrend(scope, priceArr, units, yearsLen);
}

const indexData = JSON.parse(await readFile(indexPath, "utf8"));
const prices = JSON.parse(await readFile(pricesPath, "utf8"));
const rows = indexData.d || [];
const years = indexData.meta?.years || [];
const scopes = {};
const yearsLen = years.length;

ensureScope(scopes, "all", "all", "전체", null, yearsLen);

for (const row of rows) {
  const idx = String(row.i);
  const priceArr = prices[idx] || null;
  const regionKey = `r:${row.r}`;
  const guKey = `g:${row.g}`;
  const dongKey = `d:${row.g}|${row.d}`;
  const regionLabel = regionLabels[row.r] || `지역 ${row.r}`;

  const targets = [
    ensureScope(scopes, "all", "all", "전체", null, yearsLen),
    ensureScope(scopes, regionKey, "region", regionLabel, "all", yearsLen),
    ensureScope(scopes, guKey, "gu", row.g || "미상", regionKey, yearsLen),
    ensureScope(scopes, dongKey, "dong", row.d || "미상", guKey, yearsLen),
  ];

  for (const scope of targets) addRow(scope, row, priceArr, yearsLen);
}

const indexKeys = new Set(rows.map((row) => String(row.i)));
const priceKeys = Object.keys(prices);
const extraPriceKeys = priceKeys.filter((key) => !indexKeys.has(key)).length;
const missingPriceKeys = rows.filter((row) => !prices[String(row.i)]).length;

const output = {
  meta: {
    updated: indexData.meta?.updated || null,
    generatedAt: new Date().toISOString(),
    source: {
      index: "data/index.json",
      prices: "data/prices.json",
    },
    priceBasis: "lp_recent_month_average",
    trendBasis: "yearly_average_price",
    unitBasis: "area_row_units_u",
    years,
    buckets,
    indexRows: rows.length,
    priceKeys: priceKeys.length,
    extraPriceKeys,
    missingPriceKeys,
  },
  scopes,
};

await writeFile(outputPath, `${JSON.stringify(output)}\n`, "utf8");
console.log(`wrote ${outputPath}`);
console.log(`rows=${rows.length} scopes=${Object.keys(scopes).length} extraPriceKeys=${extraPriceKeys} missingPriceKeys=${missingPriceKeys}`);
