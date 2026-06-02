import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(repoRoot, "data/index.json");
const outDir = resolve(repoRoot, "data/polygen");
const metaOut = resolve(outDir, "index.meta.json");
const slimOut = resolve(outDir, "index.slim.json");
const packedOut = resolve(outDir, "index.packed.bin");
const encoder = new TextEncoder();

class BinaryWriter {
  chunks = [];
  length = 0;

  push(bytes) {
    this.chunks.push(bytes);
    this.length += bytes.byteLength;
  }

  align(bytes) {
    const pad = (bytes - (this.length % bytes)) % bytes;
    if (pad) this.push(new Uint8Array(pad));
  }

  u32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    this.push(bytes);
  }

  typedArray(array, alignment) {
    this.align(alignment);
    this.push(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }

  toBytes() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}

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
    siblingIds: Array.isArray(row.si) && row.si.length ? row.si.join(",") : undefined,
  };
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function f32(value) {
  return hasValue(value) ? Number(value) : Number.NaN;
}

function u16(value) {
  return hasValue(value) ? Number(value) : 0xffff;
}

function u32(value) {
  return hasValue(value) ? Number(value) : 0xffffffff;
}

function parseSiblings(value) {
  if (!value) return [];
  return value.split(",").map((part) => Number(part)).filter(Number.isFinite);
}

function buildPacked(rows) {
  const strings = [];
  const stringIds = new Map();

  function intern(value) {
    if (!value) return 0;
    const found = stringIds.get(value);
    if (found !== undefined) return found;
    const id = strings.length + 1;
    stringIds.set(value, id);
    strings.push(value);
    return id;
  }

  const n = rows.length;
  const name = new Uint32Array(n);
  const region = new Uint8Array(n);
  const gu = new Uint32Array(n);
  const dong = new Uint32Array(n);
  const area = new Float32Array(n);
  const builtYear = new Uint16Array(n);
  const cagr = new Float32Array(n);
  const mdd = new Float32Array(n);
  const sharpe = new Float32Array(n);
  const tradeCount = new Uint32Array(n);
  const momentum = new Float32Array(n);
  const acceleration = new Float32Array(n);
  const transactionTotal = new Uint32Array(n);
  const latestPrice = new Float32Array(n);
  const y25 = new Float32Array(n);
  const latestDate = new Uint32Array(n);
  const source = new Uint32Array(n);
  const unitCount = new Uint32Array(n);
  const jibun = new Uint32Array(n);
  const roadAddress = new Uint32Array(n);
  const totalUnits = new Uint32Array(n);
  const siblingStart = new Uint32Array(n);
  const siblingCount = new Uint16Array(n);
  const siblingValues = [];

  rows.forEach((row, i) => {
    name[i] = intern(row.name);
    region[i] = row.region;
    gu[i] = intern(row.gu);
    dong[i] = intern(row.dong);
    area[i] = Number(row.area);
    builtYear[i] = u16(row.builtYear);
    cagr[i] = f32(row.cagr);
    mdd[i] = f32(row.mdd);
    sharpe[i] = f32(row.sharpe);
    tradeCount[i] = Number(row.tradeCount || 0);
    momentum[i] = f32(row.momentum);
    acceleration[i] = f32(row.acceleration);
    transactionTotal[i] = Number(row.transactionTotal || 0);
    latestPrice[i] = f32(row.latestPrice);
    y25[i] = f32(row.y25);
    latestDate[i] = u32(row.latestDate);
    source[i] = intern(row.source);
    unitCount[i] = u32(row.unitCount);
    jibun[i] = intern(row.jibun);
    roadAddress[i] = intern(row.roadAddress);
    totalUnits[i] = u32(row.totalUnits);

    const siblings = parseSiblings(row.siblingIds);
    siblingStart[i] = siblingValues.length;
    siblingCount[i] = siblings.length;
    siblingValues.push(...siblings);
  });

  const writer = new BinaryWriter();
  writer.push(encoder.encode("NSPIv001"));
  writer.u32(n);
  writer.u32(strings.length);
  writer.u32(siblingValues.length);

  for (const value of strings) {
    const bytes = encoder.encode(value);
    writer.u32(bytes.byteLength);
    writer.push(bytes);
  }

  writer.typedArray(name, 4);
  writer.typedArray(region, 1);
  writer.typedArray(gu, 4);
  writer.typedArray(dong, 4);
  writer.typedArray(area, 4);
  writer.typedArray(builtYear, 2);
  writer.typedArray(cagr, 4);
  writer.typedArray(mdd, 4);
  writer.typedArray(sharpe, 4);
  writer.typedArray(tradeCount, 4);
  writer.typedArray(momentum, 4);
  writer.typedArray(acceleration, 4);
  writer.typedArray(transactionTotal, 4);
  writer.typedArray(latestPrice, 4);
  writer.typedArray(y25, 4);
  writer.typedArray(latestDate, 4);
  writer.typedArray(source, 4);
  writer.typedArray(unitCount, 4);
  writer.typedArray(jibun, 4);
  writer.typedArray(roadAddress, 4);
  writer.typedArray(totalUnits, 4);
  writer.typedArray(siblingStart, 4);
  writer.typedArray(siblingCount, 2);
  writer.typedArray(new Uint32Array(siblingValues), 4);

  return { bytes: writer.toBytes(), stringCount: strings.length, siblingRefCount: siblingValues.length };
}

const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const rows = (source.d || source.data || []).map(rowToSlim);
const packed = buildPacked(rows);

mkdirSync(outDir, { recursive: true });
writeFileSync(metaOut, JSON.stringify(source.meta || {}), "utf8");
writeFileSync(slimOut, JSON.stringify({ meta: source.meta || {}, rows }), "utf8");
writeFileSync(packedOut, packed.bytes);

console.log(`[polygen] wrote index.meta.json ${source.meta ? "ok" : "empty"}`);
console.log(`[polygen] wrote index.slim.json rows=${rows.length}`);
console.log(`[polygen] wrote index.packed.bin ${packed.bytes.byteLength} bytes, strings=${packed.stringCount}, siblingRefs=${packed.siblingRefCount}`);
