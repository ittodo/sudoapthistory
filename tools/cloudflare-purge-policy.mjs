import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "https://nodostream.com";
const baseUrl = process.env.NODO_BASE_URL || DEFAULT_BASE_URL;

const routeDeps = [
  {
    routes: ["/", "/index.html"],
    patterns: [
      "index.html",
      "css/main.css",
      "js/calc-utils.js",
      "js/data-loader.js",
      "js/main-app.js",
      "js/polygen-index-loader.js",
      "js/polygen-packed-index-loader.js",
      "js/generated/browser/",
      "data/index.json",
      "data/prices.json",
      "data/volumes.json",
      "data/details.json",
      "data/geo.json",
      "data/polygen/",
    ],
  },
  {
    routes: ["/compare/", "/compare/index.html"],
    patterns: [
      "compare/index.html",
      "css/main.css",
      "js/calc-utils.js",
      "js/data-loader.js",
      "js/main-app.js",
      "js/polygen-index-loader.js",
      "js/polygen-packed-index-loader.js",
      "js/generated/browser/",
      "data/index.json",
      "data/prices.json",
      "data/volumes.json",
      "data/details.json",
      "data/geo.json",
      "data/polygen/",
    ],
  },
  {
    routes: ["/market/", "/market/index.html"],
    patterns: [
      "market/index.html",
      "data/market.json",
    ],
  },
  {
    routes: ["/trades/", "/trades/index.html"],
    patterns: [
      "trades/index.html",
      "data/market.json",
    ],
  },
  {
    routes: ["/stats/", "/stats/index.html"],
    patterns: [
      "stats/index.html",
      "css/stats.css",
      "js/stats-app.js",
      "data/price_bands.json",
      "data/holding_tax_actuals.json",
      "data/tax_revenue_actuals.json",
      "data/index.json",
    ],
  },
  {
    routes: ["/div/", "/div/index.html"],
    patterns: [
      "div/index.html",
      "data/dividends.json",
      "data/buybacks.json",
      "data/earnings_index.json",
      "data/trade/index.json",
    ],
  },
  {
    routes: ["/div/stocks/", "/div/stocks/index.html"],
    patterns: [
      "div/stocks/index.html",
      "data/dividends.json",
      "data/earnings_index.json",
    ],
  },
  {
    routes: ["/calc/", "/calc/index.html"],
    patterns: [
      "calc/index.html",
    ],
  },
];

const versionedAssets = [
  "js/main-app.js",
  "js/polygen-packed-index-loader.js",
  "js/polygen-index-loader.js",
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function changedFromGit() {
  try {
    git(["rev-parse", "--verify", "HEAD^"]);
    return git(["diff", "--name-only", "HEAD^", "HEAD"]).split(/\r?\n/).filter(Boolean);
  } catch {
    return git(["ls-tree", "-r", "--name-only", "HEAD"]).split(/\r?\n/).filter(Boolean);
  }
}

function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function toUrl(path) {
  const pathname = path.startsWith("/") ? path : `/${path}`;
  return new URL(pathname, baseUrl).href;
}

function isMatch(path, pattern) {
  return pattern.endsWith("/") ? path.startsWith(pattern) : path === pattern;
}

function isPublicFile(path) {
  if (!path || path.endsWith("/")) return false;
  if (path.startsWith(".") || path.startsWith(".github/") || path.startsWith(".claude/")) return false;
  if (path.startsWith("tools/") || path.startsWith("schemas/") || path.startsWith("docs/")) return false;
  if (path.startsWith("supabase/")) return false;
  if (path.endsWith(".bak")) return false;
  return true;
}

function readAssetVersion() {
  if (!existsSync("index.html")) return null;
  const html = readFileSync("index.html", "utf8");
  return (
    html.match(/APT_ASSET_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] ||
    html.match(/main-app\.js\?v=([^"']+)/)?.[1] ||
    null
  );
}

function addFileUrl(urls, path) {
  urls.add(toUrl(path));
  if (path.endsWith("/index.html")) {
    urls.add(toUrl(path.slice(0, -"index.html".length)));
  }
}

export function buildPurgePolicy(inputChanged) {
  const changed = inputChanged.map(normalizePath).filter(Boolean);
  const urls = new Set();
  const version = readAssetVersion();

  for (const path of changed) {
    if (isPublicFile(path)) addFileUrl(urls, path);
  }

  for (const group of routeDeps) {
    if (changed.some((path) => group.patterns.some((pattern) => isMatch(path, pattern)))) {
      for (const route of group.routes) urls.add(toUrl(route));
    }
  }

  if (changed.some((path) => path.startsWith("data/market/"))) {
    urls.add(toUrl("/market/"));
    urls.add(toUrl("/market/index.html"));
    urls.add(toUrl("/trades/"));
    urls.add(toUrl("/trades/index.html"));
  }

  if (changed.some((path) => path.startsWith("data/earnings/"))) {
    urls.add(toUrl("/div/"));
    urls.add(toUrl("/div/index.html"));
    urls.add(toUrl("/div/stocks/"));
    urls.add(toUrl("/div/stocks/index.html"));
  }

  if (changed.some((path) => path === "robots.txt" || path === "sitemap.xml" || path === "ads.txt")) {
    urls.add(toUrl("/"));
    urls.add(toUrl("/index.html"));
  }

  if (version) {
    for (const asset of versionedAssets) {
      if (changed.includes(asset)) {
        urls.add(toUrl(asset));
        urls.add(`${toUrl(asset)}?v=${encodeURIComponent(version)}`);
      }
    }
    if (changed.includes("market/index.html") || changed.includes("data/market.json")) {
      urls.add(`${toUrl("data/market.json")}?v=${encodeURIComponent(version)}`);
    }
  }

  const sortedUrls = [...urls].sort();
  return {
    changed,
    urls: sortedUrls,
    purgeEverything: sortedUrls.length > 90,
  };
}

function parseCliArgs(argv) {
  const json = argv.includes("--json");
  const files = argv.filter((arg) => arg !== "--json");
  return { json, files };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { json, files } = parseCliArgs(process.argv.slice(2));
  const policy = buildPurgePolicy(files.length ? files : changedFromGit());
  if (json) {
    console.log(JSON.stringify(policy, null, 2));
  } else if (policy.purgeEverything) {
    console.log("purge_everything=true");
  } else {
    console.log(policy.urls.join("\n"));
  }
}
