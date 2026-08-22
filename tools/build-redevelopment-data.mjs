import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const defaultAudit = "D:/Work/15_26/reconstruction_demolition_exclusion_audit_20260822.csv";
const auditPath = resolve(process.argv[2] || defaultAudit);
const statusPath = resolve(repoRoot, "data/building-status.json");
const relationsPath = resolve(repoRoot, "data/redevelopment-relations.json");
const decisionsPath = resolve(repoRoot, "data/redevelopment-decisions.json");

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { value += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(value); value = ""; }
    else if (ch === '\n') { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += ch;
  }
  if (value || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift();
  if (headers.length) headers[0] = headers[0].replace(/^\uFEFF/, "");
  return rows.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])));
}

const auditRows = parseCsv(readFileSync(auditPath, "utf8"));
const sites = {};
for (const row of auditRows) {
  let status = null;
  if (row.classification === "확정 제외") status = "demolished";
  if (row.classification === "유지·부분폐쇄 검토") status = "partial_closed";
  if (!status) continue;
  sites[row.site_key] = {
    status,
    date: row.demolition_day || undefined,
    displayName: (row.site_names || row.registry_names || "").split("|")[0],
    evidenceId: `registry-${row.site_key.replace(/[^0-9A-Za-z가-힣]+/g, "-")}`,
  };
}

const decisions = JSON.parse(readFileSync(decisionsPath, "utf8"));
Object.assign(sites, decisions.sites || {});

const output = { version: 2, updated: new Date().toISOString().slice(0, 10), sites };
writeFileSync(statusPath, JSON.stringify(output, null, 2) + "\n", "utf8");
writeFileSync(relationsPath, JSON.stringify({ version: 1, updated: output.updated, relations: decisions.relations || [] }, null, 2) + "\n", "utf8");

console.log(`[redevelopment] statuses=${Object.keys(sites).length} source=${auditPath}`);
