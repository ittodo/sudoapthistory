import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolve(repoRoot, "data/index.json");
const outDir = resolve(repoRoot, "data/polygen");
const metaOut = resolve(outDir, "index.meta.json");
const jsonOut = resolve(outDir, "index.slim.json");
const binOut = resolve(outDir, "index.slim.bin");
const generatedDir = resolve(repoRoot, "js/generated/typescript");
const generatedBinaryRefs = resolve(generatedDir, "nodostream_binary_refs.ts");
const packedWriter = resolve(repoRoot, "tools/build-packed-index.mjs");

function nullableNumber(value) {
  return value === null || value === undefined || value === "" ? undefined : Number(value);
}

function nullableString(value) {
  return value === null || value === undefined || value === "" ? undefined : String(value);
}

function rowToSlim(row, index) {
  const id = Number(row.i ?? index);
  return {
    id,
    name: String(row.n ?? ""),
    region: Number(row.r ?? 0),
    gu: String(row.g ?? ""),
    dong: nullableString(row.d),
    area: Number(row.a ?? 0),
    builtYear: nullableNumber(row.b),
    cagr: nullableNumber(row.c),
    mdd: nullableNumber(row.m),
    sharpe: nullableNumber(row.s),
    tradeCount: Number(row.v ?? 0),
    momentum: nullableNumber(row.q),
    acceleration: nullableNumber(row.k),
    transactionTotal: Number(row.t ?? 0),
    latestPrice: nullableNumber(row.lp),
    y25: nullableNumber(row.y25),
    latestDate: nullableNumber(row.ld),
    source: nullableString(row.us),
    unitCount: nullableNumber(row.u),
    jibun: nullableString(row.j),
    roadAddress: nullableString(row.rd),
    totalUnits: nullableNumber(row.tu),
    unitPartial: Number(row.up || 0),
    siblingIds: Array.isArray(row.si) && row.si.length ? row.si.join(",") : undefined,
  };
}

function writeJsonSlim() {
  const source = JSON.parse(readFileSync(inputPath, "utf8"));
  const rows = (source.d || source.data || []).map(rowToSlim);
  const meta = source.meta || {};
  mkdirSync(outDir, { recursive: true });
  writeFileSync(metaOut, JSON.stringify(meta), "utf8");
  writeFileSync(
    jsonOut,
    JSON.stringify({ meta, rows }, null, 0),
    "utf8",
  );
  return rows.length;
}

function findTsx() {
  if (process.env.TSX_BIN && existsSync(process.env.TSX_BIN)) return process.env.TSX_BIN;
  const candidates = [
    resolve(repoRoot, "node_modules/.bin/tsx.cmd"),
    resolve(repoRoot, "node_modules/.bin/tsx"),
    resolve("D:/Rust/polygen/tests/runners/typescript/node_modules/.bin/tsx.cmd"),
    resolve("D:/Rust/polygen/tests/runners/typescript/node_modules/.bin/tsx"),
  ];
  return candidates.find(existsSync);
}

function writeBinaryIfPossible() {
  if (!existsSync(generatedBinaryRefs)) {
    console.warn(`[polygen] skip bin: missing ${generatedBinaryRefs}`);
    console.warn("[polygen] run tools/generate-polygen-types.ps1 first.");
    return false;
  }

  const tsx = findTsx();
  if (!tsx) {
    console.warn("[polygen] skip bin: tsx not found. Set TSX_BIN or install tsx.");
    return false;
  }

  const writerPath = resolve(outDir, ".write-index-bin.ts");
  const writerSource = `
import { readFileSync, writeFileSync } from "node:fs";
import { NodostreamBinaryRefContext, type NodostreamContainer } from "../../js/generated/typescript/nodostream_binary_refs";

const input = JSON.parse(readFileSync(${JSON.stringify(jsonOut)}, "utf8"));
const container: NodostreamContainer = { AptIndexRows: input.rows };
const bytes = NodostreamBinaryRefContext.saveBinary(container);
writeFileSync(${JSON.stringify(binOut)}, bytes);
console.log(\`[polygen] wrote index.slim.bin \${bytes.byteLength} bytes\`);
`;

  writeFileSync(writerPath, writerSource, "utf8");
  try {
    if (process.platform === "win32" && tsx.toLowerCase().endsWith(".cmd")) {
      execFileSync("cmd.exe", ["/c", tsx, writerPath], { cwd: repoRoot, stdio: "inherit" });
    } else {
      execFileSync(tsx, [writerPath], { cwd: repoRoot, stdio: "inherit" });
    }
  } finally {
    rmSync(writerPath, { force: true });
  }
  return true;
}

function writePackedIfPossible() {
  execFileSync("node", [packedWriter], { cwd: repoRoot, stdio: "inherit" });
  return true;
}

const count = writeJsonSlim();
const wroteBin = writeBinaryIfPossible();
writePackedIfPossible();
console.log(`[polygen] wrote index.slim.json rows=${count}`);
if (!wroteBin) process.exitCode = 0;
