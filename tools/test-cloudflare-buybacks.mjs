import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../div/index.html',import.meta.url),'utf8');
const helpers=html.slice(html.indexOf('function buybackBucket('),html.indexOf('function buildMeta('));
const meta=html.slice(html.indexOf('function buildMeta('),html.indexOf('function buildYearSelect('));
function context(){
 const c=vm.createContext({});
 vm.runInContext(`const YEARS=[2026]; let tickerMeta={},yearAgg={}; let divData=[],bbData=[]; const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); ${helpers} ${meta}`,c);
 return c;
}
test('contracts, disposals and unknown types never inflate yearly purchase or return totals',()=>{
 const c=context();
 vm.runInContext(`bbData=[{ticker:'A',name:'A',type:'매입',buybackDate:'2026-09-30',totalAmount:100},{ticker:'A',type:'신탁계약',buybackDate:'2026-09-29',totalAmount:15000000000},{ticker:'A',type:'소각',buybackDate:'2026-09-30',totalAmount:40},{ticker:'A',type:'처분',buybackDate:'2026-09-30',totalAmount:999},{ticker:'A',type:'unknown',buybackDate:'2026-09-30',totalAmount:999}];buildMeta();`,c);
 assert.equal(vm.runInContext('yearAgg[2026].buyTotal',c),100);
 assert.equal(vm.runInContext('tickerMeta.A.yearBuy[2026]',c),100);
 assert.equal(vm.runInContext('yearAgg[2026].cancelTotal',c),40);
 assert.equal(vm.runInContext('buybackBucket({})',c),'buy');
 assert.equal(vm.runInContext("buybackBucket({type:'신탁계약'})",c),null);
 // Monthly and annual calculations consume the same classification.
 assert.match(html,/const bucket=buybackBucket\(e\);\s*if\(bucket==='cancel'\)monthly/);
 assert.match(html,/else if\(bucket==='buy'\)monthly\[ym\]\.buyT/);
});
test('contract amount and unknown shares are explicit, and disclosure text is escaped',()=>{
 const c=context();
 const badge=vm.runInContext(`buybackBadge({type:'신탁계약',method:'신탁계약 체결',note:'<img src=x onerror=alert(1)>'})`,c);
 assert.match(badge,/신탁계약 · 집계 제외/);
 assert.match(badge,/실제 매입 실적이 아닙니다/);
 assert.match(badge,/주식수는 미확정/);
 assert.match(badge,/&lt;img/);assert.doesNotMatch(badge,/<img/);
 assert.equal((html.match(/const tb=buybackBadge\(e\)/g)||[]).length,2);
 assert.match(html,/계약 시작/);
});
test('all inline scripts compile after the presentation update',()=>{
 for(const [,attrs,code] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
  if(!/\bsrc=/.test(attrs) && !/type=["']application\/ld\+json/.test(attrs))new vm.Script(code);
 }
});
