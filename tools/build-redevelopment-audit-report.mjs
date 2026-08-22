import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(process.argv[2] || "D:/Work/_ops/consistency-audit-20260822/redevelopment.html");
const status = JSON.parse(readFileSync(resolve(root, "data/building-status.json"), "utf8"));
const relations = JSON.parse(readFileSync(resolve(root, "data/redevelopment-relations.json"), "utf8")).relations || [];
const evidence = JSON.parse(readFileSync(resolve(root, "data/redevelopment-evidence.json"), "utf8")).evidence || {};
const review = JSON.parse(readFileSync(resolve(root, "data/redevelopment-review-queue.json"), "utf8")).sites || [];
const labels = { demolished: "멸실", rebuilding: "재건축 중", rebuilt: "재건축 완료", partial_closed: "일부폐쇄", active: "현행" };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const statusRows = Object.entries(status.sites || {}).sort((a, b) => a[0].localeCompare(b[0], "ko"));
const counts = statusRows.reduce((out, [, item]) => { out[item.status] = (out[item.status] || 0) + 1; return out; }, {});

function table(headers, rows) {
  return `<div class="table"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>재건축·멸실 정합성 감사</title><style>
body{margin:0;background:#f8fafc;color:#172033;font-family:Arial,"Malgun Gothic",sans-serif}.wrap{max-width:1380px;margin:auto;padding:28px 20px 60px}h1{font-size:28px;margin:0 0 8px}h2{font-size:19px;margin:30px 0 10px}.sub{color:#64748b}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:20px 0}.metric{background:#fff;border:1px solid #dbe3ee;border-radius:6px;padding:12px}.metric b{display:block;font-size:24px;margin-top:4px}.table{overflow:auto;background:#fff;border:1px solid #dbe3ee;border-radius:6px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:8px 10px;border-bottom:1px solid #e7edf5;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#edf3f9;white-space:nowrap}code{font-size:11px}a{color:#075aa5}.note{padding:12px;background:#fff7df;border-left:3px solid #d79a00}.status{font-weight:700;white-space:nowrap}</style></head><body><main class="wrap">
<h1>재건축·멸실 관계형 정합성 감사</h1><p class="sub">기준일 ${esc(status.updated)} · 과거 거래는 유지하고 현행 목록과 집계에서만 확정 비활성 단지를 제외합니다.</p>
<div class="metrics"><div class="metric">멸실<b>${counts.demolished || 0}</b></div><div class="metric">재건축 중<b>${counts.rebuilding || 0}</b></div><div class="metric">재건축 완료<b>${counts.rebuilt || 0}</b></div><div class="metric">일부폐쇄<b>${counts.partial_closed || 0}</b></div><div class="metric">관계<b>${relations.length}</b></div><div class="metric">검토 대기<b>${review.length}</b></div></div>
<p class="note">다대다 관계를 지원합니다. 하나의 관계에 이전 단지와 후속 단지를 각각 여러 개 넣을 수 있으며, 일부 편입과 불명확 범위는 기본 목록에서 숨기지 않습니다.</p>
<h2>전체 상태 목록 (${statusRows.length})</h2>${table(["상태", "단지", "사이트 키", "기준일", "근거"], statusRows.map(([key, item]) => `<tr><td class="status">${esc(labels[item.status] || item.status)}</td><td>${esc(item.displayName)}</td><td><code>${esc(key)}</code></td><td>${esc(item.date || "-")}</td><td>${esc(item.evidenceId || "건축물대장 폐쇄 감사")}</td></tr>`))}
<h2>재건축 관계 (${relations.length})</h2>${table(["사업", "이전 단지", "후속 단지", "단계", "범위", "확인일"], relations.map((r) => `<tr><td>${esc(r.projectName || r.id)}</td><td>${r.predecessors.map((x) => `<code>${esc(x.siteKey)}</code>`).join("<br>")}</td><td>${r.successors.map((x) => `<code>${esc(x.siteKey || x.displayName)}</code>`).join("<br>")}</td><td>${esc(r.stage)}</td><td>${r.predecessors.map((x) => esc(x.scope)).join(", ")}</td><td>${esc(r.verifiedAt)}</td></tr>`))}
<h2>검토 대기 (${review.length})</h2>${table(["단지", "사이트 키", "보류 사유"], review.map((x) => `<tr><td>${esc(x.displayName)}</td><td><code>${esc(x.siteKey)}</code></td><td>${esc(x.reason)}</td></tr>`))}
<h2>판정 근거 (${Object.keys(evidence).length})</h2>${table(["근거", "문서", "확인일"], Object.entries(evidence).map(([id, x]) => `<tr><td><code>${esc(id)}</code></td><td><a href="${esc(x.url)}">${esc(x.title)}</a></td><td>${esc(x.checkedAt)}</td></tr>`))}
</main></body></html>`;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, html, "utf8");
console.log(`[redevelopment] report=${output} statuses=${statusRows.length} relations=${relations.length} review=${review.length}`);
