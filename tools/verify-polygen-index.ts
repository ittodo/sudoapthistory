import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodostreamBinaryRefContext } from "../js/generated/typescript/nodostream_binary_refs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsonPath = resolve(repoRoot, "data/polygen/index.slim.json");
const binPath = resolve(repoRoot, "data/polygen/index.slim.bin");

const json = JSON.parse(readFileSync(jsonPath, "utf8"));
const bytes = readFileSync(binPath);
const ctx = NodostreamBinaryRefContext.openBinary(bytes);

assert(ctx.AptIndexRows.count === json.rows.length, "row count mismatch");

const first = ctx.AptIndexRows.at(0);
assert(first.id === json.rows[0].id, "first id mismatch");
assert(first.name === json.rows[0].name, "first name mismatch");
assert(first.gu === json.rows[0].gu, "first gu mismatch");

const byId = ctx.AptIndexRows.getById(json.rows[1].id);
assert(byId, "getById failed");
assert(byId.name === json.rows[1].name, "getById name mismatch");

const byGu = ctx.AptIndexRows.findByGu(json.rows[0].gu);
assert(byGu.length > 0, "findByGu failed");

console.log(`[polygen] verified rows=${ctx.AptIndexRows.count} bytes=${bytes.byteLength}`);
