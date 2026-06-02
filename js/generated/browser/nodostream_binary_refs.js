var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// js/generated/typescript/binary_ref.ts
var MAGIC = new Uint8Array([80, 71, 66, 82, 69, 70, 49, 0]);
var VERSION = 1;
var textEncoder = new TextEncoder();
var textDecoder = new TextDecoder();
var BinaryDocumentOwner = class {
  constructor(input) {
    __publicField(this, "bytes");
    __publicField(this, "view");
    this.bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }
  get length() {
    return this.bytes.byteLength;
  }
  reader(offset = 0) {
    return new BinaryRefReader(this.bytes, offset);
  }
};
var BinaryRefReader = class {
  constructor(input, offset = 0) {
    __publicField(this, "bytes");
    __publicField(this, "view");
    __publicField(this, "offset");
    this.bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.offset = offset;
    BinaryRefFormat.checkRange(this.bytes, offset, 0);
  }
  position() {
    return this.offset;
  }
  seek(offset) {
    BinaryRefFormat.checkRange(this.bytes, offset, 0);
    this.offset = offset;
  }
  skip(length) {
    BinaryRefFormat.checkRange(this.bytes, this.offset, length);
    this.offset += length;
  }
  readBool() {
    return this.readU8() !== 0;
  }
  readU8() {
    BinaryRefFormat.checkRange(this.bytes, this.offset, 1);
    return this.bytes[this.offset++];
  }
  readI8() {
    const value = this.readU8();
    return value > 127 ? value - 256 : value;
  }
  readU16() {
    BinaryRefFormat.checkRange(this.bytes, this.offset, 2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }
  readI16() {
    BinaryRefFormat.checkRange(this.bytes, this.offset, 2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }
  readU32() {
    BinaryRefFormat.checkRange(this.bytes, this.offset, 4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }
  readI32() {
    BinaryRefFormat.checkRange(this.bytes, this.offset, 4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }
  readU64() {
    BinaryRefFormat.checkRange(this.bytes, this.offset, 8);
    const value = Number(this.view.getBigUint64(this.offset, true));
    this.offset += 8;
    return value;
  }
  readI64() {
    BinaryRefFormat.checkRange(this.bytes, this.offset, 8);
    const value = Number(this.view.getBigInt64(this.offset, true));
    this.offset += 8;
    return value;
  }
  readF32() {
    BinaryRefFormat.checkRange(this.bytes, this.offset, 4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }
  readF64() {
    BinaryRefFormat.checkRange(this.bytes, this.offset, 8);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }
  readBytes(length) {
    BinaryRefFormat.checkRange(this.bytes, this.offset, length);
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
};
var BinaryRefWriter = class {
  constructor() {
    __publicField(this, "chunks", []);
    __publicField(this, "totalLength", 0);
  }
  get length() {
    return this.totalLength;
  }
  writeBool(value) {
    this.writeU8(value ? 1 : 0);
  }
  writeU8(value) {
    this.push(new Uint8Array([value & 255]));
  }
  writeI8(value) {
    this.writeU8(value);
  }
  writeU16(value) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, value, true);
    this.push(b);
  }
  writeI16(value) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setInt16(0, value, true);
    this.push(b);
  }
  writeU32(value) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value, true);
    this.push(b);
  }
  writeI32(value) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, value, true);
    this.push(b);
  }
  writeU64(value) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(value), true);
    this.push(b);
  }
  writeI64(value) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, BigInt(value), true);
    this.push(b);
  }
  writeF32(value) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, value, true);
    this.push(b);
  }
  writeF64(value) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, value, true);
    this.push(b);
  }
  writeRaw(bytes) {
    this.push(bytes);
  }
  toUint8Array() {
    const out = new Uint8Array(this.totalLength);
    let cursor = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, cursor);
      cursor += chunk.byteLength;
    }
    return out;
  }
  push(bytes) {
    this.chunks.push(bytes);
    this.totalLength += bytes.byteLength;
  }
};
var BinaryRefFormat = class {
  static writeHeader(writer) {
    writer.writeRaw(MAGIC);
    writer.writeI32(VERSION);
  }
  static readHeader(reader) {
    const magic = reader.readBytes(MAGIC.byteLength);
    for (let i = 0; i < MAGIC.byteLength; i++) {
      if (magic[i] !== MAGIC[i]) {
        throw new Error("Invalid PolyGen binary ref header.");
      }
    }
    const version = reader.readI32();
    if (version !== VERSION) {
      throw new Error(`Unsupported PolyGen binary ref version: ${version}.`);
    }
  }
  static writeString(writer, value) {
    const bytes = textEncoder.encode(value);
    writer.writeI32(bytes.byteLength);
    writer.writeRaw(bytes);
  }
  static readString(reader) {
    const length = reader.readI32();
    if (length < 0) throw new Error("Negative string length.");
    return textDecoder.decode(reader.readBytes(length));
  }
  static writeBytes(writer, value) {
    writer.writeI32(value.byteLength);
    writer.writeRaw(value);
  }
  static readLengthPrefixedBytes(buffer, offset) {
    this.checkRange(buffer, offset, 4);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const length = view.getInt32(offset, true);
    if (length < 0) throw new Error("Negative binary payload length.");
    const payloadOffset = offset + 4;
    this.checkRange(buffer, payloadOffset, length);
    return buffer.subarray(payloadOffset, payloadOffset + length);
  }
  static readUtf8String(buffer, offset) {
    return textDecoder.decode(this.readLengthPrefixedBytes(buffer, offset));
  }
  static requireFieldOffset(buffer, rowOffset, fieldIndex) {
    const offset = this.getFieldOffset(buffer, rowOffset, fieldIndex);
    if (offset < 0) throw new Error(`Missing required binary field at index ${fieldIndex}.`);
    return offset;
  }
  static getFieldOffset(buffer, rowOffset, fieldIndex) {
    this.checkRange(buffer, rowOffset, 4);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const fieldCount = view.getInt32(rowOffset, true);
    if (fieldCount < 0) throw new Error("Negative binary field count.");
    if (fieldIndex < 0 || fieldIndex >= fieldCount) return -1;
    const tableOffset = rowOffset + 4;
    this.checkRange(buffer, tableOffset, fieldCount * 4);
    const relative = view.getInt32(tableOffset + fieldIndex * 4, true);
    if (relative < 0) return -1;
    const absolute = rowOffset + relative;
    this.checkRange(buffer, absolute, 0);
    return absolute;
  }
  static readBool(buffer, offset) {
    this.checkRange(buffer, offset, 1);
    return buffer[offset] !== 0;
  }
  static readU8(buffer, offset) {
    this.checkRange(buffer, offset, 1);
    return buffer[offset];
  }
  static readI8(buffer, offset) {
    const value = this.readU8(buffer, offset);
    return value > 127 ? value - 256 : value;
  }
  static readU16(buffer, offset) {
    this.checkRange(buffer, offset, 2);
    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint16(offset, true);
  }
  static readI16(buffer, offset) {
    this.checkRange(buffer, offset, 2);
    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getInt16(offset, true);
  }
  static readU32(buffer, offset) {
    this.checkRange(buffer, offset, 4);
    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(offset, true);
  }
  static readI32(buffer, offset) {
    this.checkRange(buffer, offset, 4);
    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getInt32(offset, true);
  }
  static readU64(buffer, offset) {
    this.checkRange(buffer, offset, 8);
    return Number(new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getBigUint64(offset, true));
  }
  static readI64(buffer, offset) {
    this.checkRange(buffer, offset, 8);
    return Number(new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getBigInt64(offset, true));
  }
  static readF32(buffer, offset) {
    this.checkRange(buffer, offset, 4);
    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getFloat32(offset, true);
  }
  static readF64(buffer, offset) {
    this.checkRange(buffer, offset, 8);
    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getFloat64(offset, true);
  }
  static readTimestamp(buffer, offset) {
    const ticks = this.readI64(buffer, offset);
    return new Date(ticks / 1e4 - 621355968e5);
  }
  static writeTimestamp(writer, value) {
    writer.writeI64((value.getTime() + 621355968e5) * 1e4);
  }
  static checkRange(buffer, offset, length) {
    if (offset < 0 || length < 0 || offset > buffer.byteLength || length > buffer.byteLength - offset) {
      throw new Error("Binary ref offset is outside the document.");
    }
  }
};
var BinaryRefRowBuilder = class {
  constructor(fieldCount) {
    __publicField(this, "fields");
    if (fieldCount < 0) throw new Error("Negative binary field count.");
    this.fields = new Array(fieldCount).fill(null);
  }
  setField(index, write) {
    const writer = new BinaryRefWriter();
    write(writer);
    this.fields[index] = writer.toUint8Array();
  }
  toUint8Array() {
    const writer = new BinaryRefWriter();
    writer.writeI32(this.fields.length);
    let cursor = 4 + this.fields.length * 4;
    for (const field of this.fields) {
      if (field == null) {
        writer.writeI32(-1);
      } else {
        writer.writeI32(cursor);
        cursor += field.byteLength;
      }
    }
    for (const field of this.fields) {
      if (field != null) writer.writeRaw(field);
    }
    return writer.toUint8Array();
  }
};

// js/generated/typescript/nodostream_binary_refs.ts
var nodostream_apt_AptIndexRowRef = class {
  constructor(owner, rowOffset) {
    __publicField(this, "owner", owner);
    __publicField(this, "rowOffset", rowOffset);
  }
  requiredFieldOffset(fieldIndex) {
    return BinaryRefFormat.requireFieldOffset(this.owner.bytes, this.rowOffset, fieldIndex);
  }
  optionalFieldOffset(fieldIndex) {
    return BinaryRefFormat.getFieldOffset(this.owner.bytes, this.rowOffset, fieldIndex);
  }
  get id() {
    return BinaryRefFormat.readU32(this.owner.bytes, this.requiredFieldOffset(0));
  }
  get nameUtf8() {
    return BinaryRefFormat.readLengthPrefixedBytes(this.owner.bytes, this.requiredFieldOffset(1));
  }
  get name() {
    return BinaryRefFormat.readUtf8String(this.owner.bytes, this.requiredFieldOffset(1));
  }
  get region() {
    return BinaryRefFormat.readU8(this.owner.bytes, this.requiredFieldOffset(2));
  }
  get guUtf8() {
    return BinaryRefFormat.readLengthPrefixedBytes(this.owner.bytes, this.requiredFieldOffset(3));
  }
  get gu() {
    return BinaryRefFormat.readUtf8String(this.owner.bytes, this.requiredFieldOffset(3));
  }
  get hasDong() {
    return this.optionalFieldOffset(4) >= 0;
  }
  get dongUtf8() {
    const o = this.optionalFieldOffset(4);
    return o < 0 ? new Uint8Array() : BinaryRefFormat.readLengthPrefixedBytes(this.owner.bytes, o);
  }
  get dong() {
    const o = this.optionalFieldOffset(4);
    return o < 0 ? void 0 : BinaryRefFormat.readUtf8String(this.owner.bytes, o);
  }
  get area() {
    return BinaryRefFormat.readF32(this.owner.bytes, this.requiredFieldOffset(5));
  }
  get hasBuiltYear() {
    return this.optionalFieldOffset(6) >= 0;
  }
  get builtYear() {
    const o = this.optionalFieldOffset(6);
    return o < 0 ? void 0 : BinaryRefFormat.readU16(this.owner.bytes, o);
  }
  get hasCagr() {
    return this.optionalFieldOffset(7) >= 0;
  }
  get cagr() {
    const o = this.optionalFieldOffset(7);
    return o < 0 ? void 0 : BinaryRefFormat.readF32(this.owner.bytes, o);
  }
  get hasMdd() {
    return this.optionalFieldOffset(8) >= 0;
  }
  get mdd() {
    const o = this.optionalFieldOffset(8);
    return o < 0 ? void 0 : BinaryRefFormat.readF32(this.owner.bytes, o);
  }
  get hasSharpe() {
    return this.optionalFieldOffset(9) >= 0;
  }
  get sharpe() {
    const o = this.optionalFieldOffset(9);
    return o < 0 ? void 0 : BinaryRefFormat.readF32(this.owner.bytes, o);
  }
  get tradeCount() {
    return BinaryRefFormat.readU32(this.owner.bytes, this.requiredFieldOffset(10));
  }
  get hasMomentum() {
    return this.optionalFieldOffset(11) >= 0;
  }
  get momentum() {
    const o = this.optionalFieldOffset(11);
    return o < 0 ? void 0 : BinaryRefFormat.readF32(this.owner.bytes, o);
  }
  get hasAcceleration() {
    return this.optionalFieldOffset(12) >= 0;
  }
  get acceleration() {
    const o = this.optionalFieldOffset(12);
    return o < 0 ? void 0 : BinaryRefFormat.readF32(this.owner.bytes, o);
  }
  get transactionTotal() {
    return BinaryRefFormat.readU32(this.owner.bytes, this.requiredFieldOffset(13));
  }
  get hasLatestPrice() {
    return this.optionalFieldOffset(14) >= 0;
  }
  get latestPrice() {
    const o = this.optionalFieldOffset(14);
    return o < 0 ? void 0 : BinaryRefFormat.readF32(this.owner.bytes, o);
  }
  get hasY25() {
    return this.optionalFieldOffset(15) >= 0;
  }
  get y25() {
    const o = this.optionalFieldOffset(15);
    return o < 0 ? void 0 : BinaryRefFormat.readF32(this.owner.bytes, o);
  }
  get hasLatestDate() {
    return this.optionalFieldOffset(16) >= 0;
  }
  get latestDate() {
    const o = this.optionalFieldOffset(16);
    return o < 0 ? void 0 : BinaryRefFormat.readU32(this.owner.bytes, o);
  }
  get hasSource() {
    return this.optionalFieldOffset(17) >= 0;
  }
  get sourceUtf8() {
    const o = this.optionalFieldOffset(17);
    return o < 0 ? new Uint8Array() : BinaryRefFormat.readLengthPrefixedBytes(this.owner.bytes, o);
  }
  get source() {
    const o = this.optionalFieldOffset(17);
    return o < 0 ? void 0 : BinaryRefFormat.readUtf8String(this.owner.bytes, o);
  }
  get hasUnitCount() {
    return this.optionalFieldOffset(18) >= 0;
  }
  get unitCount() {
    const o = this.optionalFieldOffset(18);
    return o < 0 ? void 0 : BinaryRefFormat.readU32(this.owner.bytes, o);
  }
  get hasJibun() {
    return this.optionalFieldOffset(19) >= 0;
  }
  get jibunUtf8() {
    const o = this.optionalFieldOffset(19);
    return o < 0 ? new Uint8Array() : BinaryRefFormat.readLengthPrefixedBytes(this.owner.bytes, o);
  }
  get jibun() {
    const o = this.optionalFieldOffset(19);
    return o < 0 ? void 0 : BinaryRefFormat.readUtf8String(this.owner.bytes, o);
  }
  get hasRoadAddress() {
    return this.optionalFieldOffset(20) >= 0;
  }
  get roadAddressUtf8() {
    const o = this.optionalFieldOffset(20);
    return o < 0 ? new Uint8Array() : BinaryRefFormat.readLengthPrefixedBytes(this.owner.bytes, o);
  }
  get roadAddress() {
    const o = this.optionalFieldOffset(20);
    return o < 0 ? void 0 : BinaryRefFormat.readUtf8String(this.owner.bytes, o);
  }
  get hasTotalUnits() {
    return this.optionalFieldOffset(21) >= 0;
  }
  get totalUnits() {
    const o = this.optionalFieldOffset(21);
    return o < 0 ? void 0 : BinaryRefFormat.readU32(this.owner.bytes, o);
  }
  get hasSiblingIds() {
    return this.optionalFieldOffset(22) >= 0;
  }
  get siblingIdsUtf8() {
    const o = this.optionalFieldOffset(22);
    return o < 0 ? new Uint8Array() : BinaryRefFormat.readLengthPrefixedBytes(this.owner.bytes, o);
  }
  get siblingIds() {
    const o = this.optionalFieldOffset(22);
    return o < 0 ? void 0 : BinaryRefFormat.readUtf8String(this.owner.bytes, o);
  }
  toOwned() {
    const obj = {};
    obj.id = this.id;
    obj.name = this.name;
    obj.region = this.region;
    obj.gu = this.gu;
    if (this.dong !== void 0) obj.dong = this.dong;
    obj.area = this.area;
    if (this.builtYear !== void 0) obj.builtYear = this.builtYear;
    if (this.cagr !== void 0) obj.cagr = this.cagr;
    if (this.mdd !== void 0) obj.mdd = this.mdd;
    if (this.sharpe !== void 0) obj.sharpe = this.sharpe;
    obj.tradeCount = this.tradeCount;
    if (this.momentum !== void 0) obj.momentum = this.momentum;
    if (this.acceleration !== void 0) obj.acceleration = this.acceleration;
    obj.transactionTotal = this.transactionTotal;
    if (this.latestPrice !== void 0) obj.latestPrice = this.latestPrice;
    if (this.y25 !== void 0) obj.y25 = this.y25;
    if (this.latestDate !== void 0) obj.latestDate = this.latestDate;
    if (this.source !== void 0) obj.source = this.source;
    if (this.unitCount !== void 0) obj.unitCount = this.unitCount;
    if (this.jibun !== void 0) obj.jibun = this.jibun;
    if (this.roadAddress !== void 0) obj.roadAddress = this.roadAddress;
    if (this.totalUnits !== void 0) obj.totalUnits = this.totalUnits;
    if (this.siblingIds !== void 0) obj.siblingIds = this.siblingIds;
    return obj;
  }
};
var nodostream_apt_AptIndexRowRefCodec = class {
  static writeRow(obj) {
    const builder = new BinaryRefRowBuilder(23);
    builder.setField(0, (w) => {
      w.writeU32(obj.id);
    });
    builder.setField(1, (w) => {
      BinaryRefFormat.writeString(w, obj.name);
    });
    builder.setField(2, (w) => {
      w.writeU8(obj.region);
    });
    builder.setField(3, (w) => {
      BinaryRefFormat.writeString(w, obj.gu);
    });
    const dongValue = obj.dong;
    if (dongValue !== void 0 && dongValue !== null) builder.setField(4, (w) => {
      BinaryRefFormat.writeString(w, dongValue);
    });
    builder.setField(5, (w) => {
      w.writeF32(obj.area);
    });
    const builtYearValue = obj.builtYear;
    if (builtYearValue !== void 0 && builtYearValue !== null) builder.setField(6, (w) => {
      w.writeU16(builtYearValue);
    });
    const cagrValue = obj.cagr;
    if (cagrValue !== void 0 && cagrValue !== null) builder.setField(7, (w) => {
      w.writeF32(cagrValue);
    });
    const mddValue = obj.mdd;
    if (mddValue !== void 0 && mddValue !== null) builder.setField(8, (w) => {
      w.writeF32(mddValue);
    });
    const sharpeValue = obj.sharpe;
    if (sharpeValue !== void 0 && sharpeValue !== null) builder.setField(9, (w) => {
      w.writeF32(sharpeValue);
    });
    builder.setField(10, (w) => {
      w.writeU32(obj.tradeCount);
    });
    const momentumValue = obj.momentum;
    if (momentumValue !== void 0 && momentumValue !== null) builder.setField(11, (w) => {
      w.writeF32(momentumValue);
    });
    const accelerationValue = obj.acceleration;
    if (accelerationValue !== void 0 && accelerationValue !== null) builder.setField(12, (w) => {
      w.writeF32(accelerationValue);
    });
    builder.setField(13, (w) => {
      w.writeU32(obj.transactionTotal);
    });
    const latestPriceValue = obj.latestPrice;
    if (latestPriceValue !== void 0 && latestPriceValue !== null) builder.setField(14, (w) => {
      w.writeF32(latestPriceValue);
    });
    const y25Value = obj.y25;
    if (y25Value !== void 0 && y25Value !== null) builder.setField(15, (w) => {
      w.writeF32(y25Value);
    });
    const latestDateValue = obj.latestDate;
    if (latestDateValue !== void 0 && latestDateValue !== null) builder.setField(16, (w) => {
      w.writeU32(latestDateValue);
    });
    const sourceValue = obj.source;
    if (sourceValue !== void 0 && sourceValue !== null) builder.setField(17, (w) => {
      BinaryRefFormat.writeString(w, sourceValue);
    });
    const unitCountValue = obj.unitCount;
    if (unitCountValue !== void 0 && unitCountValue !== null) builder.setField(18, (w) => {
      w.writeU32(unitCountValue);
    });
    const jibunValue = obj.jibun;
    if (jibunValue !== void 0 && jibunValue !== null) builder.setField(19, (w) => {
      BinaryRefFormat.writeString(w, jibunValue);
    });
    const roadAddressValue = obj.roadAddress;
    if (roadAddressValue !== void 0 && roadAddressValue !== null) builder.setField(20, (w) => {
      BinaryRefFormat.writeString(w, roadAddressValue);
    });
    const totalUnitsValue = obj.totalUnits;
    if (totalUnitsValue !== void 0 && totalUnitsValue !== null) builder.setField(21, (w) => {
      w.writeU32(totalUnitsValue);
    });
    const siblingIdsValue = obj.siblingIds;
    if (siblingIdsValue !== void 0 && siblingIdsValue !== null) builder.setField(22, (w) => {
      BinaryRefFormat.writeString(w, siblingIdsValue);
    });
    return builder.toUint8Array();
  }
};
var nodostream_apt_AptIndexRowRefTable = class _nodostream_apt_AptIndexRowRefTable {
  constructor(owner, rowOffsets, byId, byGu, byRegion) {
    __publicField(this, "owner", owner);
    __publicField(this, "rowOffsets", rowOffsets);
    __publicField(this, "byId", byId);
    __publicField(this, "byGu", byGu);
    __publicField(this, "byRegion", byRegion);
  }
  get count() {
    return this.rowOffsets.length;
  }
  *all() {
    for (const offset of this.rowOffsets) yield new nodostream_apt_AptIndexRowRef(this.owner, offset);
  }
  at(index) {
    return new nodostream_apt_AptIndexRowRef(this.owner, this.rowOffsets[index]);
  }
  getById(key) {
    const offset = this.byId.get(key);
    return offset === void 0 ? void 0 : new nodostream_apt_AptIndexRowRef(this.owner, offset);
  }
  findByGu(key) {
    const offsets = this.byGu.get(key);
    return offsets === void 0 ? [] : offsets.map((offset) => new nodostream_apt_AptIndexRowRef(this.owner, offset));
  }
  findByRegion(key) {
    const offsets = this.byRegion.get(key);
    return offsets === void 0 ? [] : offsets.map((offset) => new nodostream_apt_AptIndexRowRef(this.owner, offset));
  }
  static write(writer, sourceRows) {
    BinaryRefFormat.writeString(writer, "nodostream.apt.AptIndexRow");
    const rows = [];
    let cursor = 0;
    for (const row of sourceRows) {
      const bytes = nodostream_apt_AptIndexRowRefCodec.writeRow(row);
      rows.push({ row, offset: cursor, bytes });
      cursor += bytes.byteLength;
    }
    writer.writeI32(rows.length);
    for (const row of rows) writer.writeI32(row.offset);
    writer.writeI32(3);
    BinaryRefFormat.writeString(writer, "ById");
    writer.writeBool(true);
    {
      const map = /* @__PURE__ */ new Map();
      for (const row of rows) map.set(row.row.id, row.offset);
      writer.writeI32(map.size);
      for (const [key, offset] of map) {
        writer.writeU32(key);
        writer.writeI32(offset);
      }
    }
    BinaryRefFormat.writeString(writer, "ByGu");
    writer.writeBool(false);
    {
      const map = /* @__PURE__ */ new Map();
      for (const row of rows) {
        const key = row.row.gu;
        let offsets = map.get(key);
        if (offsets === void 0) {
          offsets = [];
          map.set(key, offsets);
        }
        offsets.push(row.offset);
      }
      writer.writeI32(map.size);
      for (const [key, offsets] of map) {
        BinaryRefFormat.writeString(writer, key);
        writer.writeI32(offsets.length);
        for (const offset of offsets) writer.writeI32(offset);
      }
    }
    BinaryRefFormat.writeString(writer, "ByRegion");
    writer.writeBool(false);
    {
      const map = /* @__PURE__ */ new Map();
      for (const row of rows) {
        const key = row.row.region;
        let offsets = map.get(key);
        if (offsets === void 0) {
          offsets = [];
          map.set(key, offsets);
        }
        offsets.push(row.offset);
      }
      writer.writeI32(map.size);
      for (const [key, offsets] of map) {
        writer.writeU8(key);
        writer.writeI32(offsets.length);
        for (const offset of offsets) writer.writeI32(offset);
      }
    }
    writer.writeI32(cursor);
    for (const row of rows) writer.writeRaw(row.bytes);
  }
  static read(owner, reader) {
    const tableName = BinaryRefFormat.readString(reader);
    if (tableName !== "nodostream.apt.AptIndexRow") throw new Error(`Expected table 'nodostream.apt.AptIndexRow' but found '${tableName}'.`);
    const rowCount = reader.readI32();
    if (rowCount < 0) throw new Error("Negative row count.");
    const rowOffsets = [];
    for (let i = 0; i < rowCount; i++) rowOffsets.push(reader.readI32());
    const indexCount = reader.readI32();
    if (indexCount !== 3) throw new Error(`Unexpected index count for nodostream.apt.AptIndexRow: ${indexCount}.`);
    const byId = /* @__PURE__ */ new Map();
    {
      const indexName = BinaryRefFormat.readString(reader);
      if (indexName !== "ById") throw new Error(`Expected index 'ById' but found '${indexName}'.`);
      const isUnique = reader.readBool();
      if (isUnique !== true) throw new Error("Binary index uniqueness does not match generated schema.");
      const entryCount = reader.readI32();
      if (entryCount < 0) throw new Error("Negative index entry count.");
      for (let i = 0; i < entryCount; i++) {
        const key = reader.readU32();
        byId.set(key, reader.readI32());
      }
    }
    const byGu = /* @__PURE__ */ new Map();
    {
      const indexName = BinaryRefFormat.readString(reader);
      if (indexName !== "ByGu") throw new Error(`Expected index 'ByGu' but found '${indexName}'.`);
      const isUnique = reader.readBool();
      if (isUnique !== false) throw new Error("Binary index uniqueness does not match generated schema.");
      const entryCount = reader.readI32();
      if (entryCount < 0) throw new Error("Negative index entry count.");
      for (let i = 0; i < entryCount; i++) {
        const key = BinaryRefFormat.readString(reader);
        const valueCount = reader.readI32();
        if (valueCount < 0) throw new Error("Negative group index value count.");
        const offsets = [];
        for (let j = 0; j < valueCount; j++) offsets.push(reader.readI32());
        byGu.set(key, offsets);
      }
    }
    const byRegion = /* @__PURE__ */ new Map();
    {
      const indexName = BinaryRefFormat.readString(reader);
      if (indexName !== "ByRegion") throw new Error(`Expected index 'ByRegion' but found '${indexName}'.`);
      const isUnique = reader.readBool();
      if (isUnique !== false) throw new Error("Binary index uniqueness does not match generated schema.");
      const entryCount = reader.readI32();
      if (entryCount < 0) throw new Error("Negative index entry count.");
      for (let i = 0; i < entryCount; i++) {
        const key = reader.readU8();
        const valueCount = reader.readI32();
        if (valueCount < 0) throw new Error("Negative group index value count.");
        const offsets = [];
        for (let j = 0; j < valueCount; j++) offsets.push(reader.readI32());
        byRegion.set(key, offsets);
      }
    }
    const rowBlockLength = reader.readI32();
    if (rowBlockLength < 0) throw new Error("Negative row block length.");
    const rowBlockStart = reader.position();
    reader.skip(rowBlockLength);
    for (let i = 0; i < rowOffsets.length; i++) rowOffsets[i] = rowBlockStart + rowOffsets[i];
    for (const [key, offset] of byId) byId.set(key, rowBlockStart + offset);
    for (const offsets of byGu.values()) {
      for (let i = 0; i < offsets.length; i++) offsets[i] = rowBlockStart + offsets[i];
    }
    for (const offsets of byRegion.values()) {
      for (let i = 0; i < offsets.length; i++) offsets[i] = rowBlockStart + offsets[i];
    }
    return new _nodostream_apt_AptIndexRowRefTable(
      owner,
      rowOffsets,
      byId,
      byGu,
      byRegion
    );
  }
};
var NodostreamBinaryRefContext = class _NodostreamBinaryRefContext {
  constructor(owner, AptIndexRows) {
    __publicField(this, "owner", owner);
    __publicField(this, "AptIndexRows", AptIndexRows);
  }
  static openBinary(input) {
    const owner = new BinaryDocumentOwner(input);
    const reader = owner.reader();
    BinaryRefFormat.readHeader(reader);
    const tableCount = reader.readI32();
    if (tableCount !== 1) throw new Error(`Unexpected table count: ${tableCount}.`);
    const AptIndexRows = nodostream_apt_AptIndexRowRefTable.read(owner, reader);
    return new _NodostreamBinaryRefContext(
      owner,
      AptIndexRows
    );
  }
  static saveBinary(container) {
    const writer = new BinaryRefWriter();
    BinaryRefFormat.writeHeader(writer);
    writer.writeI32(1);
    nodostream_apt_AptIndexRowRefTable.write(writer, container.AptIndexRows);
    return writer.toUint8Array();
  }
};
export {
  NodostreamBinaryRefContext,
  nodostream_apt_AptIndexRowRef,
  nodostream_apt_AptIndexRowRefTable
};
