// ../15_26/_ops/housing-packed/generated/typescript/packed_columns.ts
var encoder = new TextEncoder();
var decoder = new TextDecoder("utf-8", { fatal: true });
var magic = "PGCOL001";
var widths = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8, f32: 4, f64: 8, string: 4 };
var methods = { u8: "Uint8", i8: "Int8", u16: "Uint16", i16: "Int16", u32: "Uint32", i32: "Int32", u64: "BigUint64", i64: "BigInt64", f32: "Float32", f64: "Float64" };
function schemaCheck(s) {
  if (!s.name || !Number.isSafeInteger(s.version) || s.version < 1 || !/^[a-f0-9]{64}$/.test(s.fingerprint) || !s.fields.length || s.fields.length > 1024) throw Error("Invalid packed schema");
  const names = /* @__PURE__ */ new Set();
  for (const f of s.fields) {
    if (!f.name || names.has(f.name) || !Object.hasOwn(widths, f.type)) throw Error("Invalid packed field");
    names.add(f.name);
  }
}
function integer(value, type) {
  const signed = type[0] === "i", bits = Number(type.slice(1));
  if (typeof value === "number" && !Number.isSafeInteger(value) || typeof value !== "number" && typeof value !== "bigint") throw Error("Exact integer required");
  const v = BigInt(value), lo = signed ? -(1n << BigInt(bits - 1)) : 0n, hi = signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n;
  if (v < lo || v > hi) throw Error("Packed integer out of range");
  return bits === 64 ? v : Number(v);
}
function utf8Order(a, b) {
  const x = encoder.encode(a), y = encoder.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}
function encodeColumns(schema, rows) {
  schemaCheck(schema);
  if (rows.length > 4294967295 || rows.some((r) => r.length !== schema.fields.length)) throw Error("Invalid packed rows");
  const chunks = [], columns = [];
  let offset = 0;
  const append = (b) => {
    const start = offset;
    chunks.push(b);
    offset += b.length;
    return start;
  };
  for (let c = 0; c < schema.fields.length; c++) {
    const f = schema.fields[c], bitmap = new Uint8Array(Math.ceil(rows.length / 8));
    let dictionary = [];
    let dict = /* @__PURE__ */ new Map();
    if (f.type === "string") {
      for (const row of rows) {
        const v = row[c];
        if (v !== null && typeof v !== "string") throw Error("String required");
      }
      dictionary = [...new Set(rows.map((r) => r[c]).filter((v) => typeof v === "string"))].sort(utf8Order);
      dict = new Map(dictionary.map((v, i) => [v, i]));
    }
    const hexWidth = f.type === "string" && dictionary.length > rows.length / 2 && dictionary.length && dictionary[0].length <= 64 && dictionary[0].length % 2 === 0 && dictionary.every((v) => v.length === dictionary[0].length && /^[0-9a-f]+$/.test(v)) ? dictionary[0].length / 2 : 0;
    const data = new Uint8Array(rows.length * (hexWidth || widths[f.type])), view = new DataView(data.buffer);
    for (let r = 0; r < rows.length; r++) {
      const v = rows[r][c];
      if (v === null) {
        if (!f.nullable) throw Error("Null in required column");
        continue;
      }
      if (v === void 0) throw Error("Missing packed field");
      bitmap[r >> 3] |= 1 << (r & 7);
      if (f.type === "string") {
        if (hexWidth) {
          for (let i = 0; i < hexWidth; i++) data[r * hexWidth + i] = parseInt(v.slice(i * 2, i * 2 + 2), 16);
        } else view.setUint32(r * 4, dict.get(v), true);
      } else if (f.type[0] === "f") {
        if (typeof v !== "number" || !Number.isFinite(v)) throw Error("Finite float required");
        if (f.type === "f32" && !Number.isFinite(Math.fround(v))) throw Error("Float32 overflow");
        view["set" + methods[f.type]](r * widths[f.type], v, true);
      } else view["set" + methods[f.type]](r * widths[f.type], integer(v, f.type), true);
    }
    const valid = append(bitmap), values = append(data);
    let strings = null;
    if (f.type === "string" && !hexWidth) {
      const encoded = dictionary.map((v) => encoder.encode(v)), positions = new Uint8Array((encoded.length + 1) * 4), p2 = new DataView(positions.buffer);
      let n = 0;
      encoded.forEach((v, i) => {
        p2.setUint32(i * 4, n, true);
        n += v.length;
      });
      p2.setUint32(encoded.length * 4, n, true);
      const offsets = append(positions), start = offset;
      for (const value of encoded) append(value);
      strings = { count: encoded.length, offsets, start, length: n };
    }
    columns.push({ valid, values, strings, ...hexWidth ? { hexWidth } : {} });
  }
  const header = encoder.encode(JSON.stringify({ schema: schema.name, version: schema.version, fingerprint: schema.fingerprint, fields: schema.fields.map((f) => ({ name: f.name, type: f.type, nullable: !!f.nullable })), rows: rows.length, bytes: offset, columns }));
  if (header.length > 1024 * 1024) throw Error("Packed header too large");
  const output = new Uint8Array(12 + header.length + offset);
  output.set(encoder.encode(magic));
  new DataView(output.buffer).setUint32(8, header.length, true);
  output.set(header, 12);
  let p = 12 + header.length;
  for (const chunk of chunks) {
    output.set(chunk, p);
    p += chunk.length;
  }
  return output;
}
function openColumns(schema, input) {
  schemaCheck(schema);
  const bytes = input, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || decoder.decode(bytes.subarray(0, 8)) !== magic) throw Error("Wrong packed format");
  const size = view.getUint32(8, true);
  if (size > 1024 * 1024 || 12 + size > bytes.length) throw Error("Invalid packed header");
  const header = JSON.parse(decoder.decode(bytes.subarray(12, 12 + size))), start = 12 + size;
  if (header.schema !== schema.name || header.version !== schema.version || header.fingerprint !== schema.fingerprint || !Array.isArray(header.fields) || header.fields.length !== schema.fields.length || header.fields.some((f, i) => f.name !== schema.fields[i].name || f.type !== schema.fields[i].type || Boolean(f.nullable) !== Boolean(schema.fields[i].nullable))) throw Error("Packed schema mismatch");
  if (!Number.isSafeInteger(header.rows) || header.rows < 0 || header.rows > 4294967295 || header.bytes !== bytes.length - start || !Array.isArray(header.columns) || header.columns.length !== schema.fields.length) throw Error("Invalid packed dimensions");
  let cursor = 0;
  const take = (offset, length) => {
    if (!Number.isSafeInteger(offset) || offset !== cursor || !Number.isSafeInteger(length) || length < 0 || offset + length > header.bytes) throw Error("Invalid packed section");
    cursor += length;
    return new DataView(bytes.buffer, bytes.byteOffset + start + offset, length);
  };
  const columns = schema.fields.map((f, i) => {
    const c = header.columns[i], hexWidth = c.hexWidth ?? 0;
    if (hexWidth && (f.type !== "string" || !Number.isInteger(hexWidth) || hexWidth < 1 || hexWidth > 32)) throw Error("Invalid packed hex width");
    const valid = take(c.valid, Math.ceil(header.rows / 8)), values = take(c.values, header.rows * (hexWidth || widths[f.type]));
    let strings = [];
    if (f.type === "string" && !hexWidth) {
      const d = c.strings;
      if (!d || !Number.isSafeInteger(d.count) || d.count < 0 || d.count > header.rows) throw Error("Invalid string count");
      const positions = take(d.offsets, (d.count + 1) * 4);
      take(d.start, d.length);
      let previous = 0;
      for (let j = 0; j < d.count; j++) {
        const from = positions.getUint32(j * 4, true), to = positions.getUint32((j + 1) * 4, true);
        if (from !== previous || to < from || to > d.length) throw Error("Invalid string offsets");
        strings.push(decoder.decode(bytes.subarray(start + d.start + from, start + d.start + to)));
        previous = to;
      }
      if (previous !== d.length || positions.getUint32(0, true) !== 0) throw Error("Invalid string payload");
    } else if (c.strings !== null) throw Error("Unexpected string section");
    for (let r = 0; r < header.rows; r++) {
      const present = !!(valid.getUint8(r >> 3) & 1 << (r & 7));
      if (!present && !f.nullable) throw Error("Missing required value");
      if (present && f.type === "string" && !hexWidth && values.getUint32(r * 4, true) >= strings.length) throw Error("Unknown dictionary reference");
      if (present && f.type[0] === "f" && !Number.isFinite(values["get" + methods[f.type]](r * widths[f.type], true))) throw Error("Nonfinite float");
    }
    return { field: f, get(row) {
      if (!Number.isInteger(row) || row < 0 || row >= header.rows) throw Error("Row out of range");
      if (!(valid.getUint8(row >> 3) & 1 << (row & 7))) return null;
      return f.type === "string" ? hexWidth ? Array.from({ length: hexWidth }, (_, j) => values.getUint8(row * hexWidth + j).toString(16).padStart(2, "0")).join("") : strings[values.getUint32(row * 4, true)] : values["get" + methods[f.type]](row * widths[f.type], true);
    } };
  });
  if (cursor !== header.bytes) throw Error("Trailing packed data");
  return { rowCount: header.rows, columns, row(index) {
    return columns.map((c) => c.get(index));
  } };
}

// <stdin>
var schemas = { "ComplexIdentity": { "name": "nodostream.housing.ComplexIdentity", "version": 1, "fields": [{ "name": "id", "type": "u32", "nullable": false }, { "name": "source_namespace", "type": "string", "nullable": false }, { "name": "source_id", "type": "string", "nullable": false }, { "name": "property_type", "type": "u8", "nullable": false }, { "name": "lifecycle", "type": "u8", "nullable": false }], "fingerprint": "601afa4c9433cfcebe1a307d86a2e346f2c8b922d7999be380bfaa1dc54a7385" }, "AreaIdentity": { "name": "nodostream.housing.AreaIdentity", "version": 1, "fields": [{ "name": "id", "type": "u32", "nullable": false }, { "name": "complex_id", "type": "u32", "nullable": false }, { "name": "exact_area", "type": "string", "nullable": false }], "fingerprint": "e7d0ff3ab0e14e1e9eb8f97f6ed2736967d3a89c9546dc2bb0cf6fb46620492e" }, "TradeGroup": { "name": "nodostream.housing.TradeGroup", "version": 1, "fields": [{ "name": "month", "type": "u8", "nullable": false }, { "name": "complex_id", "type": "u32", "nullable": false }, { "name": "area_id", "type": "u32", "nullable": false }, { "name": "kind", "type": "u8", "nullable": false }, { "name": "start", "type": "u32", "nullable": false }, { "name": "count", "type": "u32", "nullable": false }], "fingerprint": "2a49c4991f36cefe7fcef045629c1091528b0355d1088d64131ca0be7014edef" }, "SaleFact": { "name": "nodostream.housing.SaleFact", "version": 1, "fields": [{ "name": "day", "type": "u8", "nullable": false }, { "name": "floor", "type": "i16", "nullable": true }, { "name": "price", "type": "i64", "nullable": false }, { "name": "price_scale", "type": "u8", "nullable": false }, { "name": "status", "type": "u8", "nullable": false }, { "name": "identity", "type": "string", "nullable": false }, { "name": "multiplicity", "type": "u32", "nullable": false }], "fingerprint": "27ad52d802fb519215c65ab73d9356aca680ec462dab44f448acaead3a05e208" }, "RentalFact": { "name": "nodostream.housing.RentalFact", "version": 1, "fields": [{ "name": "day", "type": "u8", "nullable": false }, { "name": "floor", "type": "i16", "nullable": true }, { "name": "deposit", "type": "i64", "nullable": false }, { "name": "rent", "type": "i64", "nullable": false }, { "name": "money_scale", "type": "u8", "nullable": false }, { "name": "contract_kind", "type": "u8", "nullable": false }, { "name": "status", "type": "u8", "nullable": false }, { "name": "identity", "type": "string", "nullable": false }, { "name": "multiplicity", "type": "u32", "nullable": false }], "fingerprint": "3f454f8ced692f22792452ff2161be36befb24375c7d8fa55c0604f339cb7838" }, "ConversionRate": { "name": "nodostream.housing.ConversionRate", "version": 1, "fields": [{ "name": "region", "type": "u32", "nullable": false }, { "name": "month", "type": "u32", "nullable": false }, { "name": "value", "type": "i64", "nullable": false }, { "name": "scale", "type": "u8", "nullable": false }, { "name": "source", "type": "string", "nullable": false }], "fingerprint": "01182a676ef1ea72e5a0b4d68e8311ede48039f0060388f7eae135e97362444b" }, "Metadata": { "name": "nodostream.housing.Metadata", "version": 1, "fields": [{ "name": "complex_id", "type": "u32", "nullable": false }, { "name": "name", "type": "string", "nullable": false }, { "name": "address", "type": "string", "nullable": true }, { "name": "latitude", "type": "f64", "nullable": true }, { "name": "longitude", "type": "f64", "nullable": true }, { "name": "built_year", "type": "u16", "nullable": true }, { "name": "total_units", "type": "u32", "nullable": true }, { "name": "unit_source", "type": "string", "nullable": true }], "fingerprint": "4d2afe2ea852cb8b0c7667d807848deb1ab756951f16fdbfa713b8ec7210f6d0" }, "AreaMetadata": { "name": "nodostream.housing.AreaMetadata", "version": 1, "fields": [{ "name": "area_id", "type": "u32", "nullable": false }, { "name": "units", "type": "u32", "nullable": true }, { "name": "unit_source", "type": "string", "nullable": true }], "fingerprint": "2a5fe98ea9520b588ff49008e70c7cb9d7272c4bed64596588f284efb2b4b764" }, "ApprovedLink": { "name": "nodostream.housing.ApprovedLink", "version": 1, "fields": [{ "name": "source_id", "type": "u32", "nullable": false }, { "name": "target_region", "type": "u32", "nullable": false }, { "name": "target_id", "type": "u32", "nullable": false }, { "name": "approved_parcel", "type": "string", "nullable": false }, { "name": "evidence", "type": "string", "nullable": false }], "fingerprint": "c16621e4580fc4ca5561535ca46397489de5a95ff7145d99733c55d2b0dfdeda" }, "ContractExtra": { "name": "nodostream.housing.ContractExtra", "version": 1, "fields": [{ "name": "identity", "type": "string", "nullable": false }, { "name": "contract_term", "type": "string", "nullable": true }, { "name": "cancel_date", "type": "u32", "nullable": true }, { "name": "previous_deposit", "type": "i64", "nullable": true }, { "name": "previous_rent", "type": "i64", "nullable": true }, { "name": "money_scale", "type": "u8", "nullable": false }, { "name": "renewal_right", "type": "string", "nullable": true }], "fingerprint": "004ca65ffd37b9f8387b10a77e8de3c6480cccc8ef73dd7a5efa864f54cb3606" }, "StateChange": { "name": "nodostream.housing.StateChange", "version": 1, "fields": [{ "name": "area_id", "type": "u32", "nullable": false }, { "name": "date", "type": "u32", "nullable": false }, { "name": "kind", "type": "u8", "nullable": false }, { "name": "contract_kind", "type": "u8", "nullable": false }, { "name": "identity", "type": "string", "nullable": false }], "fingerprint": "dbc9f87c1280da9df2edabefb6b2ea70e45487c5c9e403f2ff0ef6515a003fb5" }, "Coverage": { "name": "nodostream.housing.Coverage", "version": 1, "fields": [{ "name": "region", "type": "u32", "nullable": false }, { "name": "month", "type": "u32", "nullable": false }, { "name": "service", "type": "string", "nullable": false }, { "name": "status", "type": "u8", "nullable": false }, { "name": "rows", "type": "u32", "nullable": false }], "fingerprint": "1acc013b960da3091b782e166c194b0304d28129ec88c27a362d2e785e6c4309" }, "SaleMapState": { "name": "nodostream.housing.SaleMapState", "version": 1, "fields": [{ "name": "area_id", "type": "u32", "nullable": false }, { "name": "date", "type": "u32", "nullable": false }, { "name": "low", "type": "f64", "nullable": false }, { "name": "high", "type": "f64", "nullable": false }, { "name": "mean", "type": "f64", "nullable": false }, { "name": "count", "type": "u32", "nullable": false }], "fingerprint": "1bb210f8626d3909bb961c363b3b882c398a4348c30327fb8820858348518496" }, "RentalMapState": { "name": "nodostream.housing.RentalMapState", "version": 1, "fields": [{ "name": "complex_id", "type": "u32", "nullable": false }, { "name": "exact_area", "type": "string", "nullable": false }, { "name": "date", "type": "u32", "nullable": false }, { "name": "deposit", "type": "f64", "nullable": false }, { "name": "rent", "type": "f64", "nullable": false }, { "name": "contract_kind", "type": "u8", "nullable": false }, { "name": "floor", "type": "i16", "nullable": true }, { "name": "status", "type": "u8", "nullable": false }, { "name": "previous_date", "type": "u32", "nullable": true }, { "name": "previous_low", "type": "f64", "nullable": true }, { "name": "previous_high", "type": "f64", "nullable": true }, { "name": "history_low", "type": "f64", "nullable": true }, { "name": "history_high", "type": "f64", "nullable": true }, { "name": "value", "type": "f64", "nullable": true }, { "name": "records", "type": "u32", "nullable": false }, { "name": "rate_month", "type": "u32", "nullable": true }, { "name": "rate", "type": "f64", "nullable": true }, { "name": "identity", "type": "string", "nullable": false }], "fingerprint": "43ff02ad50cd5ad236a5f1fbfe08fc0aaf65ddd5ee3007c17fd26c7b32be3cff" }, "StateInterval": { "name": "nodostream.housing.StateInterval", "version": 1, "fields": [{ "name": "first_month", "type": "u32", "nullable": false }, { "name": "last_month", "type": "u32", "nullable": false }, { "name": "position", "type": "u32", "nullable": false }, { "name": "state_id", "type": "u32", "nullable": false }], "fingerprint": "3969949b312a6ec58d27df4837ac022f8486f207efa12f99f24cf884101e1c5e" }, "SaleComparison": { "name": "nodostream.housing.SaleComparison", "version": 1, "fields": [{ "name": "previous_date", "type": "u32", "nullable": true }, { "name": "previous_low", "type": "f64", "nullable": true }, { "name": "history_high", "type": "f64", "nullable": true }, { "name": "history_low", "type": "f64", "nullable": true }, { "name": "records", "type": "u32", "nullable": false }, { "name": "previous_high", "type": "f64", "nullable": true }], "fingerprint": "048dd053ce6130a4a4ff0d3159d8ae79e0cf72a6d49ae0e32536339fc9195743" }, "RentalComparison": { "name": "nodostream.housing.RentalComparison", "version": 1, "fields": [{ "name": "previous_date", "type": "u32", "nullable": true }, { "name": "previous_low", "type": "f64", "nullable": true }, { "name": "previous_high", "type": "f64", "nullable": true }, { "name": "history_low", "type": "f64", "nullable": true }, { "name": "history_high", "type": "f64", "nullable": true }, { "name": "value", "type": "f64", "nullable": true }, { "name": "records", "type": "u32", "nullable": false }, { "name": "rate_month", "type": "string", "nullable": true }, { "name": "rate", "type": "f64", "nullable": true }], "fingerprint": "ef0e4a3ca4e3e3414ef3e26476f7ecd18c452b565e40f6fa466182cc18f4ce18" }, "TradeOrder": { "name": "nodostream.housing.TradeOrder", "version": 1, "fields": [{ "name": "month", "type": "u8", "nullable": false }, { "name": "kind", "type": "u8", "nullable": false }, { "name": "row_id", "type": "u32", "nullable": false }], "fingerprint": "ca1a651334d797dabce3cf826abc10e644ff601860c82b8c33a781796e0f8f57" }, "StateUpdateOrder": { "name": "nodostream.housing.StateUpdateOrder", "version": 1, "fields": [{ "name": "month", "type": "u8", "nullable": false }, { "name": "kind", "type": "u8", "nullable": false }, { "name": "row_id", "type": "u32", "nullable": false }], "fingerprint": "a972ca56443305df03a29bf63e16ea798533cab36f48e1b24b64fc3ccaed40dd" }, "ContractDetail": { "name": "nodostream.housing.ContractDetail", "version": 1, "fields": [{ "name": "identity", "type": "string", "nullable": false }, { "name": "occurrence", "type": "u32", "nullable": false }, { "name": "contract_term", "type": "string", "nullable": false }, { "name": "contract_type", "type": "string", "nullable": false }, { "name": "cancel_date", "type": "string", "nullable": false }, { "name": "previous_deposit", "type": "i64", "nullable": true }, { "name": "previous_rent", "type": "i64", "nullable": true }, { "name": "money_scale", "type": "u8", "nullable": false }, { "name": "renewal_right", "type": "string", "nullable": false }], "fingerprint": "bd54ed3445ae21aeadfb54b58b2cd559eeb485dd00ad013acb024e5a14742b95" }, "ContractUnmatched": { "name": "nodostream.housing.ContractUnmatched", "version": 1, "fields": [{ "name": "payload", "type": "string", "nullable": false }, { "name": "reason", "type": "string", "nullable": false }], "fingerprint": "e299b001c98f21e61fff4efb522e375cd21bb434ef0789fc5ce3754fc24ea682" }, "SaleDetailReference": { "name": "nodostream.housing.SaleDetailReference", "version": 1, "fields": [{ "name": "complex_id", "type": "u32", "nullable": false }, { "name": "rounded_area", "type": "u16", "nullable": false }, { "name": "identity", "type": "string", "nullable": false }, { "name": "occurrence", "type": "u32", "nullable": false }, { "name": "position", "type": "u32", "nullable": false }, { "name": "cancel_date", "type": "string", "nullable": false }], "fingerprint": "e62ae8fc2e91229c143628c5010073061f5c144e07e191f0db9dca452754658f" }, "ExcludedSaleFact": { "name": "nodostream.housing.ExcludedSaleFact", "version": 1, "fields": [{ "name": "area_id", "type": "u32", "nullable": false }, { "name": "date", "type": "u32", "nullable": false }, { "name": "price", "type": "i64", "nullable": false }, { "name": "price_scale", "type": "u8", "nullable": false }, { "name": "floor", "type": "i16", "nullable": true }, { "name": "status", "type": "u8", "nullable": false }, { "name": "identity", "type": "string", "nullable": false }, { "name": "reason", "type": "string", "nullable": false }], "fingerprint": "d326acf29a1ab8edb259cc196ae76f43c7e3803c8bf37bd65dda5b099ac01354" }, "PartitionOrder": { "name": "nodostream.housing.PartitionOrder", "version": 1, "fields": [{ "name": "month", "type": "u8", "nullable": false }, { "name": "collection", "type": "u8", "nullable": false }, { "name": "part", "type": "u16", "nullable": false }], "fingerprint": "e209666e8173fa49069bf9e2e27a0d7e0d1b9dc232e42eb1e6b49854fdf11d0b" } };
export {
  encodeColumns,
  openColumns,
  schemas
};
