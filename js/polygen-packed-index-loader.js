const MAGIC_V2 = "NSPIv002";
const MAGIC_V3 = "NSPIv003";
const textDecoder = new TextDecoder();

function align(offset, bytes) {
  return offset + ((bytes - (offset % bytes)) % bytes);
}

function cached(target, key, read) {
  if (Object.prototype.hasOwnProperty.call(target._cache, key)) return target._cache[key];
  const value = read();
  target._cache[key] = value;
  return value;
}

function round(value, digits) {
  const scale = 10 ** digits;
  const rounded = Math.round((value + Number.EPSILON) * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function f32(value, digits) {
  if (Number.isNaN(value)) return null;
  return digits === undefined ? value : round(value, digits);
}

function u16(value) {
  return value === 0xffff ? null : value;
}

function u32(value) {
  return value === 0xffffffff ? null : value;
}

function stringValue(strings, id) {
  return id === 0 ? "" : strings[id - 1];
}

function optionalStringValue(strings, id) {
  return id === 0 ? undefined : strings[id - 1];
}

class PackedAptIndexRow {
  constructor(index, table) {
    this._index = index;
    this._table = table;
    this._cache = Object.create(null);
  }

  get i() { return this._index; }
  get n() { return cached(this, "n", () => stringValue(this._table.strings, this._table.name[this._index])); }
  get r() { return this._table.region[this._index]; }
  get g() { return cached(this, "g", () => stringValue(this._table.strings, this._table.gu[this._index])); }
  get d() { return cached(this, "d", () => stringValue(this._table.strings, this._table.dong[this._index])); }
  get a() { return f32(this._table.area[this._index], 2); }
  get b() { return u16(this._table.builtYear[this._index]); }
  get c() { return f32(this._table.cagr[this._index], 1); }
  get m() { return f32(this._table.mdd[this._index], 1); }
  get s() { return f32(this._table.sharpe[this._index], 2); }
  get v() { return this._table.tradeCount[this._index]; }
  get q() { return f32(this._table.momentum[this._index], 1); }
  get k() { return f32(this._table.acceleration[this._index], 1); }
  get t() { return this._table.transactionTotal[this._index]; }
  get lp() { return f32(this._table.latestPrice[this._index], 2); }
  get y25() { return f32(this._table.y25[this._index], 1); }
  get ld() { return u32(this._table.latestDate[this._index]); }
  get us() { return optionalStringValue(this._table.strings, this._table.source[this._index]); }
  get u() { return u32(this._table.unitCount[this._index]); }
  get j() { return optionalStringValue(this._table.strings, this._table.jibun[this._index]); }
  get rd() { return optionalStringValue(this._table.strings, this._table.roadAddress[this._index]); }
  get as() { return optionalStringValue(this._table.strings, this._table.aptSeq[this._index]); }
  get tu() { return u32(this._table.totalUnits[this._index]); }
  get pa() { return f32(this._table.platArea[this._index], 2); }
  get fr() { return f32(this._table.floorAreaRatio[this._index], 2); }
  get pk() { return u32(this._table.parkingCount[this._index]); }
  get ls() { return f32(this._table.estimatedLandShare[this._index], 2); }
  get lr() { return f32(this._table.registryLandRight[this._index], 2); }
  get lc() { return u32(this._table.landRightCount[this._index]); }
  get ll() { return f32(this._table.landRightLow[this._index], 2); }
  get lh() { return f32(this._table.landRightHigh[this._index], 2); }
  get si() {
    return cached(this, "si", () => {
      const count = this._table.siblingCount[this._index];
      if (!count) return null;
      const start = this._table.siblingStart[this._index];
      return Array.from(this._table.siblingValues.subarray(start, start + count));
    });
  }
}

function parsePacked(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 20) throw new Error("Packed index is too small.");
  const magic = textDecoder.decode(bytes.subarray(0, 8));
  if (magic !== MAGIC_V2 && magic !== MAGIC_V3) throw new Error(`Unexpected packed index magic: ${magic}`);
  const hasAptSeq = magic === MAGIC_V3;

  const view = new DataView(buffer);
  const rowCount = view.getUint32(8, true);
  const stringCount = view.getUint32(12, true);
  const siblingValueCount = view.getUint32(16, true);
  let offset = 20;
  const strings = new Array(stringCount);

  for (let i = 0; i < stringCount; i += 1) {
    const length = view.getUint32(offset, true);
    offset += 4;
    strings[i] = textDecoder.decode(bytes.subarray(offset, offset + length));
    offset += length;
  }

  function typed(Type, count, alignment) {
    offset = align(offset, alignment);
    const out = new Type(buffer, offset, count);
    offset += out.byteLength;
    return out;
  }

  const table = {
    strings,
    name: typed(Uint32Array, rowCount, 4),
    region: typed(Uint8Array, rowCount, 1),
    gu: typed(Uint32Array, rowCount, 4),
    dong: typed(Uint32Array, rowCount, 4),
    area: typed(Float32Array, rowCount, 4),
    builtYear: typed(Uint16Array, rowCount, 2),
    cagr: typed(Float32Array, rowCount, 4),
    mdd: typed(Float32Array, rowCount, 4),
    sharpe: typed(Float32Array, rowCount, 4),
    tradeCount: typed(Uint32Array, rowCount, 4),
    momentum: typed(Float32Array, rowCount, 4),
    acceleration: typed(Float32Array, rowCount, 4),
    transactionTotal: typed(Uint32Array, rowCount, 4),
    latestPrice: typed(Float32Array, rowCount, 4),
    y25: typed(Float32Array, rowCount, 4),
    latestDate: typed(Uint32Array, rowCount, 4),
    source: typed(Uint32Array, rowCount, 4),
    unitCount: typed(Uint32Array, rowCount, 4),
    jibun: typed(Uint32Array, rowCount, 4),
    roadAddress: typed(Uint32Array, rowCount, 4),
    aptSeq: hasAptSeq ? typed(Uint32Array, rowCount, 4) : new Uint32Array(rowCount),
    totalUnits: typed(Uint32Array, rowCount, 4),
    platArea: typed(Float32Array, rowCount, 4),
    floorAreaRatio: typed(Float32Array, rowCount, 4),
    parkingCount: typed(Uint32Array, rowCount, 4),
    estimatedLandShare: typed(Float32Array, rowCount, 4),
    registryLandRight: typed(Float32Array, rowCount, 4),
    landRightCount: typed(Uint32Array, rowCount, 4),
    landRightLow: typed(Float32Array, rowCount, 4),
    landRightHigh: typed(Float32Array, rowCount, 4),
    siblingStart: typed(Uint32Array, rowCount, 4),
    siblingCount: typed(Uint16Array, rowCount, 2),
    siblingValues: typed(Uint32Array, siblingValueCount, 4),
  };

  return Array.from({ length: rowCount }, (_, index) => new PackedAptIndexRow(index, table));
}

export async function loadPackedAptIndex(base = "", version = "") {
  const prefix = base || "";
  const suffix = version ? `?v=${encodeURIComponent(version)}` : "";
  const [metaRes, binRes] = await Promise.all([
    fetch(prefix + "data/polygen/index.meta.json" + suffix),
    fetch(prefix + "data/polygen/index.packed.bin" + suffix),
  ]);

  if (!metaRes.ok) throw new Error(`Packed index meta fetch failed: ${metaRes.status}`);
  if (!binRes.ok) throw new Error(`Packed index fetch failed: ${binRes.status}`);

  const [meta, buffer] = await Promise.all([
    metaRes.json(),
    binRes.arrayBuffer(),
  ]);
  const rows = parsePacked(buffer);

  return {
    meta,
    d: rows,
    format: "polygen-packed",
    bytes: buffer.byteLength,
  };
}
