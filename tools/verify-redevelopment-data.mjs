import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const index = JSON.parse(readFileSync(resolve(root, "data/index.json"), "utf8"));
const status = JSON.parse(readFileSync(resolve(root, "data/building-status.json"), "utf8"));
const relationData = JSON.parse(readFileSync(resolve(root, "data/redevelopment-relations.json"), "utf8"));
const evidenceData = JSON.parse(readFileSync(resolve(root, "data/redevelopment-evidence.json"), "utf8"));
const allowedStatuses = new Set(["active", "rebuilding", "rebuilt", "demolished", "partial_closed"]);
const allowedScopes = new Set(["all", "partial", "unknown"]);
const allowedStages = new Set(["planned", "approved", "construction", "completed", "unknown"]);
const keyOf = (x) => `${x.r}|${x.g}|${x.d || ""}|${x.j || ""}`;
const siteKeys = new Set(index.d.map(keyOf));
const errors = [];
const relationIds = new Set();
const evidenceIds = new Set(Object.keys(evidenceData.evidence || {}));

if (status.version !== 2) errors.push("building-status version must be 2");
if (relationData.version !== 1) errors.push("redevelopment-relations version must be 1");

for (const [key, item] of Object.entries(status.sites || {})) {
  if (!siteKeys.has(key)) errors.push(`status site does not exist: ${key}`);
  if (!allowedStatuses.has(item.status)) errors.push(`invalid status ${item.status}: ${key}`);
  if (item.date && !/^\d{8}$/.test(item.date)) errors.push(`invalid date ${item.date}: ${key}`);
}

for (const row of index.d) {
  if (!row.bs && !row.bsd) continue;
  const item = status.sites[keyOf(row)];
  if (!item || item.status !== "demolished") errors.push(`index bs missing from status: ${row.i}`);
  if (row.bsd && item?.date !== String(row.bsd)) errors.push(`index bsd mismatch: ${row.i}`);
}

for (const relation of relationData.relations || []) {
  if (!relation.id || relationIds.has(relation.id)) errors.push(`duplicate or missing relation id: ${relation.id || "(missing)"}`);
  relationIds.add(relation.id);
  if (!allowedStages.has(relation.stage)) errors.push(`invalid stage: ${relation.id}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(relation.verifiedAt || "")) errors.push(`invalid verifiedAt: ${relation.id}`);
  const predecessors = relation.predecessors || [];
  const successors = relation.successors || [];
  if (!predecessors.length || !successors.length) errors.push(`relation must have both sides: ${relation.id}`);
  const predKeys = new Set();
  const successorKeys = new Set();
  for (const item of predecessors) {
    if (!allowedScopes.has(item.scope)) errors.push(`invalid scope: ${relation.id}/${item.siteKey}`);
    if (!siteKeys.has(item.siteKey)) errors.push(`predecessor does not exist: ${relation.id}/${item.siteKey}`);
    if (predKeys.has(item.siteKey)) errors.push(`duplicate predecessor: ${relation.id}/${item.siteKey}`);
    predKeys.add(item.siteKey);
  }
  for (const item of successors) {
    if (!siteKeys.has(item.siteKey) && !item.displayName) errors.push(`unresolved successor needs displayName: ${relation.id}/${item.siteKey}`);
    if (successorKeys.has(item.siteKey)) errors.push(`duplicate successor: ${relation.id}/${item.siteKey}`);
    if (predKeys.has(item.siteKey)) errors.push(`self relation: ${relation.id}/${item.siteKey}`);
    successorKeys.add(item.siteKey);
  }
  for (const evidenceId of relation.evidenceIds || []) {
    if (!evidenceIds.has(evidenceId)) errors.push(`evidence does not exist: ${relation.id}/${evidenceId}`);
  }
}

if (errors.length) {
  console.error(errors.slice(0, 100).join("\n"));
  process.exit(1);
}
console.log(`[redevelopment] verified rows=${index.d.length} statuses=${Object.keys(status.sites || {}).length} relations=${(relationData.relations || []).length}`);
