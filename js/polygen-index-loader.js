import { NodostreamBinaryRefContext } from "./generated/browser/nodostream_binary_refs.js";

function cached(target, key, read) {
  if (Object.prototype.hasOwnProperty.call(target._cache, key)) return target._cache[key];
  const value = read();
  target._cache[key] = value;
  return value;
}

function optionalNumber(value) {
  return value === undefined ? null : value;
}

function optionalString(value) {
  return value === undefined ? "" : value;
}

class AptIndexLegacyRef {
  constructor(ref, index) {
    this._ref = ref;
    this._index = index;
    this._cache = Object.create(null);
  }

  get i() { return cached(this, "i", () => this._ref.id ?? this._index); }
  get n() { return cached(this, "n", () => this._ref.name); }
  get r() { return cached(this, "r", () => this._ref.region); }
  get g() { return cached(this, "g", () => this._ref.gu); }
  get d() { return cached(this, "d", () => optionalString(this._ref.dong)); }
  get a() { return cached(this, "a", () => this._ref.area); }
  get b() { return cached(this, "b", () => optionalNumber(this._ref.builtYear)); }
  get c() { return cached(this, "c", () => optionalNumber(this._ref.cagr)); }
  get m() { return cached(this, "m", () => optionalNumber(this._ref.mdd)); }
  get s() { return cached(this, "s", () => optionalNumber(this._ref.sharpe)); }
  get v() { return cached(this, "v", () => this._ref.tradeCount); }
  get q() { return cached(this, "q", () => optionalNumber(this._ref.momentum)); }
  get k() { return cached(this, "k", () => optionalNumber(this._ref.acceleration)); }
  get t() { return cached(this, "t", () => this._ref.transactionTotal); }
  get lp() { return cached(this, "lp", () => optionalNumber(this._ref.latestPrice)); }
  get y25() { return cached(this, "y25", () => optionalNumber(this._ref.y25)); }
  get ld() { return cached(this, "ld", () => optionalNumber(this._ref.latestDate)); }
  get us() { return cached(this, "us", () => this._ref.source); }
  get u() { return cached(this, "u", () => optionalNumber(this._ref.unitCount)); }
  get j() { return cached(this, "j", () => this._ref.jibun); }
  get rd() { return cached(this, "rd", () => this._ref.roadAddress); }
  get tu() { return cached(this, "tu", () => optionalNumber(this._ref.totalUnits)); }
  get si() {
    return cached(this, "si", () => {
      const ids = this._ref.siblingIds;
      if (!ids) return null;
      const parsed = ids.split(",").map((id) => Number(id)).filter(Number.isFinite);
      return parsed.length ? parsed : null;
    });
  }
}

export async function loadPolygenAptIndex(base = "") {
  const prefix = base || "";
  const [metaRes, binRes] = await Promise.all([
    fetch(prefix + "data/polygen/index.meta.json"),
    fetch(prefix + "data/polygen/index.slim.bin"),
  ]);

  if (!metaRes.ok) throw new Error(`PolyGen meta fetch failed: ${metaRes.status}`);
  if (!binRes.ok) throw new Error(`PolyGen binary fetch failed: ${binRes.status}`);

  const [meta, buffer] = await Promise.all([
    metaRes.json(),
    binRes.arrayBuffer(),
  ]);

  const bytes = new Uint8Array(buffer);
  const context = NodostreamBinaryRefContext.openBinary(bytes);
  const rows = [];
  let index = 0;
  for (const ref of context.AptIndexRows.all()) {
    rows.push(new AptIndexLegacyRef(ref, index));
    index += 1;
  }

  return {
    meta,
    d: rows,
    format: "polygen-binary",
    bytes: bytes.byteLength,
  };
}
