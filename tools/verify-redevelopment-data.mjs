import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function verifyRedevelopmentData({index,status,relationData,evidenceData,housing,decisionData}) {
const contract = 'current-review-publication-v1';
const current = status.contract === contract || housing?.meta?.contract === contract;
const allowedStatuses = new Set(current ? ['active','closed','partial_closed','unknown'] : ["active", "rebuilding", "rebuilt", "demolished", "partial_closed"]);
const historicalStatuses = new Set(['closed','partial_closed','demolished','rebuilding','rebuilt']);
const allowedScopes = new Set(["all", "partial", "unknown"]);
const allowedStages = new Set(["planned", "approved", "construction", "completed", "unknown"]);
const keyOf = (x) => `${x.r}|${x.g}|${x.d || ""}|${x.j || ""}`;
const siteKeys = new Set(index.d.map(keyOf));
const errors = [];
const warnings = [];
const relationIds = new Set();
const evidenceIds = new Set(Object.keys(evidenceData.evidence || {}));
const siteSources = new Map();
for (const row of index.d) {
  const key = keyOf(row);
  if (!siteSources.has(key)) siteSources.set(key, new Set());
  siteSources.get(key).add(row.as);
}

if (status.version !== 2) errors.push("building-status version must be 2");
if (relationData.version !== 1) errors.push("redevelopment-relations version must be 1");
if (status.contract && status.contract !== contract) errors.push('unsupported building-status contract');
if (current) {
  if (status.contract !== contract || status.candidateOnly !== false || status.approvedOnly !== false) errors.push('invalid current building-status publication flags');
  if (housing?.meta?.contract !== contract || housing.meta.candidateOnly !== false || housing.meta.approvedOnly !== false) errors.push('current building-status requires matching housing publication');
  if (!/^[a-f0-9]{64}$/.test(status.sourceVersion || '') || status.sourceVersion !== housing?.meta?.sourceVersion) errors.push('current building-status source version mismatch');
  for (const key of siteKeys) if (!status.sites?.[key]) errors.push(`current status site is missing: ${key}`);
}

for (const [key, item] of Object.entries(status.sites || {})) {
  if (!siteKeys.has(key)) {
    if (current || item.status === "active") errors.push(`status site does not exist: ${key}`);
    else warnings.push(`inactive status site is outside current trade index: ${key}`);
  }
  if (!allowedStatuses.has(item.status)) errors.push(`invalid status ${item.status}: ${key}`);
  if (item.date && !/^\d{8}$/.test(item.date)) errors.push(`invalid date ${item.date}: ${key}`);
  if (current) {
    if (item.basis !== 'current_ledger_connections') errors.push(`invalid current status basis: ${key}`);
    if (item.demolitionConfirmed !== false) errors.push(`ledger status cannot confirm demolition: ${key}`);
    const ids = item.sourceIds, expected = siteSources.get(key) || new Set();
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id || !expected.has(id)) || new Set(ids).size !== ids.length || ids.length !== expected.size)
      errors.push(`current status source IDs differ from trade site: ${key}`);
  }
}

for (const row of index.d) {
  if (!row.bs && !row.bsd) continue;
  if (current) { errors.push(`legacy demolition flag in current index: ${row.i}`); continue; }
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
    if (!siteKeys.has(item.siteKey)) {
      let historical = status.sites?.[item.siteKey];
      // Current lifecycle contains only current trade sites. A historical relation
      // can retain an explicit redevelopment decision; it cannot change a current status.
      if (!historical && current && decisionData?.version === 1) {
        const decision = decisionData.sites?.[item.siteKey];
        if (decision && historicalStatuses.has(decision.status) && decision.displayName
            && typeof decision.evidenceId === 'string' && evidenceIds.has(decision.evidenceId)
            && (relation.evidenceIds || []).includes(decision.evidenceId)) historical = decision;
      }
      if (!historical || !historicalStatuses.has(historical.status) || !historical.displayName) {
        errors.push(`unresolved predecessor needs inactive status and displayName: ${relation.id}/${item.siteKey}`);
      } else {
        warnings.push(`historical predecessor is outside current trade index: ${relation.id}/${item.siteKey}`);
      }
    }
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

return {errors,warnings,rows:index.d.length,statuses:Object.keys(status.sites || {}).length,relations:(relationData.relations || []).length,mode:current?'current-review':'legacy'};
}

export function verifyRedevelopmentFiles(root) {
  const read = name => JSON.parse(readFileSync(resolve(root, 'data', name), 'utf8'));
  return verifyRedevelopmentData({index:read('index.json'),status:read('building-status.json'),relationData:read('redevelopment-relations.json'),evidenceData:read('redevelopment-evidence.json'),housing:existsSync(resolve(root,'data/housing-v3/index.json'))?read('housing-v3/index.json'):undefined,decisionData:existsSync(resolve(root,'data/redevelopment-decisions.json'))?read('redevelopment-decisions.json'):undefined});
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
const root = resolve(import.meta.dirname, '..');
const {errors,warnings,rows,statuses,relations,mode} = verifyRedevelopmentFiles(root);
if (errors.length) {
  console.error(errors.slice(0, 100).join("\n"));
  process.exit(1);
}
if (warnings.length) console.warn(warnings.join("\n"));
console.log(`[redevelopment] verified rows=${rows} statuses=${statuses} relations=${relations} warnings=${warnings.length} mode=${mode}`);
}
