import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

globalThis.fetch = async function fetchFile(url) {
  const parsed = String(url);
  const path = parsed.startsWith("file:") ? fileURLToPath(parsed) : resolve(repoRoot, parsed);
  return {
    ok: true,
    status: 200,
    async json() {
      return JSON.parse(readFileSync(path, "utf8"));
    },
    async arrayBuffer() {
      const bytes = readFileSync(path);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = JSON.parse(readFileSync(resolve(repoRoot, "data/index.json"), "utf8"));
const expectedRows = json.d || [];
const loaderUrl = pathToFileURL(resolve(repoRoot, "js/polygen-packed-index-loader.js")).href;
const { loadPackedAptIndex } = await import(loaderUrl);
const loaded = await loadPackedAptIndex("");

assert(loaded.d.length === expectedRows.length, "row count mismatch");

const first = loaded.d[0];
assert(first.i === (expectedRows[0].i ?? 0), "first id mismatch");
assert(first.n === expectedRows[0].n, "first name mismatch");
assert(first.g === expectedRows[0].g, "first gu mismatch");
assert(first.d === (expectedRows[0].d || ""), "first dong mismatch");

const last = loaded.d[loaded.d.length - 1];
const expectedLast = expectedRows[expectedRows.length - 1];
assert(last.n === expectedLast.n, "last name mismatch");
assert(last.t === expectedLast.t, "last transaction total mismatch");

const siblingRow = loaded.d.find((row) => row.si && row.si.length > 1);
if (siblingRow) {
  const expected = expectedRows[siblingRow.i].si;
  assert(siblingRow.si.length === expected.length, "sibling count mismatch");
  assert(siblingRow.si.every((value, index) => value === expected[index]), "sibling values mismatch");
}

console.log(`[polygen] verified packed rows=${loaded.d.length} bytes=${loaded.bytes}`);
