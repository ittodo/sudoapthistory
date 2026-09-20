const assert=require('node:assert/strict');
require('../js/daily-model.js');
require('../js/map-model.js');
const M=globalThis.NodoDailyModel;
assert.equal(M.shift('2024-01-31',1,'month'),'2024-02-29');
assert.equal(M.shift('2026-12-31',1),'2027-01-01');
assert.equal(M.shift('2026-01-01',-1),'2025-12-31');
assert.equal(M.valid('2026-02-30'),false);
assert.equal(M.detailArea(84.5),84);assert.equal(M.detailArea(85.5),86);
const catalog={complexes:[{id:'A',r:1,g:'중구',n:'단지',coord:[37,127],tu:100,b:2000}],areas:[[0,'84.90'],[0,'84.95']]};
const t=M.decode([0,20260102,90000,4,0,20260101,100000,120000,95000,6,'id',100000],catalog);
assert.equal(t.a,84.9);
assert.equal(M.match(t,{r:1,aH:84.91,pH:9}),true);
assert.equal(M.match(t,{r:2}),false);
assert.equal(M.match(t,{aL:84.95}),false);
assert.equal(M.category(t,'down'),true);assert.equal(M.category(t,'low'),true);
assert.equal(M.category({...t,flags:2},'all'),false);
const summary=M.summary([t,{...t,flags:1,records:0},{...t,flags:2,records:0}]);
assert.deepEqual(summary,{count:2,up:0,high:0,low:1,down:1,direct:1,unlocated:0,inactive:1,cancelled:1,missing:0});
const rising={...t,p:110000,records:0};
assert.equal(M.category(rising,'up'),true);
assert.ok(Math.abs(M.changeRate(rising)-10)<1e-9);
assert.match(M.badge(rising),/직전 대비 상승/);
assert.equal(M.category({...rising,p:100000},'up'),false);
assert.equal(M.category(t,'up'),false);
for(const flags of [1,2,4,6])assert.equal(M.category({...rising,flags},'up'),false);
for(const change of [{previousMin:null},{previousMin:0},{previousDate:null},{previousDate:rising.d}])
  assert.equal(M.category({...rising,...change},'up'),false);
assert.equal(M.summary([rising,{...rising,flags:1},{...rising,flags:2},t]).up,1);
assert.match(M.badge({...rising,records:1}),/신고가/);
const before=[0,20251231,100,120,110,2],after=[0,20260102,90,130,110,2],future=[0,20260105,200,200,200,1];
const state={opening:[before],updates:[after,future]};
assert.deepEqual(M.snapshot(state,20260101).get(0),before);
assert.deepEqual(M.snapshot(state,20260103).get(0),after);
assert.deepEqual(M.snapshot(state,20260102).get(0),after);
assert.deepEqual(M.snapshot(state,20260101).get(0),before,'reverse seek must not retain future state');
assert.deepEqual(M.filters(new URLSearchParams('r=9&aL=90&aH=80&pL=no&q=단지')),{aL:90,q:'단지'});
assert.equal(globalThis.NodoMapModel.clusterSummary([{area:{latest:[20260101,100],excludeAggregate:true}},{area:{latest:[20260101,200]}}]).average,200);
console.log('Daily exact-area, category, historical seeking, dates and direct-trade aggregate checks passed');
const cursor=M.priceCursor(state);
for(const day of [20260101,20260102,20260103,20260105,20260105,20260101,20260104,20260105]){
  const actual=cursor.seek(day);
  assert.deepEqual([...actual.values],[...M.snapshot(state,day)],'incremental and full snapshot must agree at '+day);
  assert.ok(actual.atDate.every(e=>e.state[1]===day));
}
assert.equal(cursor.seek(20260105).events.length,0,'same date must do no extra update work');
assert.equal(cursor.seek(20260105).atDate.length,1,'same-date filtering keeps that day’s events');
assert.equal(cursor.seek(20260106).atDate.length,0,'no trade, no effect');
const points=Array.from({length:5000},(_,i)=>({x:i%1000,y:Math.floor(i/1000)*100,count:2,direction:i%2?1:-1}));
const clustered=M.effectClusters(points,1000,600);
assert.ok(clustered.length<=80);assert.equal(clustered.reduce((s,p)=>s+p.count,0),10000);
assert.equal(M.effectClusters([{x:-1,y:2,count:1,direction:0}],100,100).length,0);
console.log('Incremental replay, reverse seek, empty dates and bounded effects passed');

// Calendar periods remain inclusive across year/month boundaries.
assert.deepEqual(M.periodRange('2026-01-01','week'),{start:'2025-12-29',end:'2026-01-04',from:'2025-12-29',to:'2026-01-04'});
assert.deepEqual(M.periodRange('2024-02-15','month'),{start:'2024-02-01',end:'2024-02-29',from:'2024-02-01',to:'2024-02-29'});
assert.deepEqual(M.periodRange('2026-09-17','week','2006-01-01','2026-09-17'),{start:'2026-09-14',end:'2026-09-20',from:'2026-09-14',to:'2026-09-17'});
assert.equal(M.periodRange('2006-01-01','week','2006-01-01','2026-09-17').from,'2006-01-01');
assert.deepEqual(M.monthsBetween('2026-01-31','2026-03-01'),['2026-01','2026-02','2026-03']);
assert.deepEqual(M.monthsBetween('2025-12-29','2026-01-04'),['2025-12','2026-01']);
console.log('Calendar periods: partial weeks, leap February and exact month requests passed');

const annualBase={p:121,previousMin:100,previousMax:100,previousDate:20240101,d:20260101,flags:0};
const annual=M.annualChange(annualBase);
assert.equal(annual.days,731);assert.ok(Math.abs(annual.rate-10)<0.02);
assert.ok(M.annualChange({...annualBase,p:81}).rate<0);
assert.equal(M.annualChange({...annualBase,p:100}),null);
for(const flags of [1,2,4])assert.equal(M.annualChange({...annualBase,flags}),null);
for(const override of [{previousMin:null},{previousMin:0},{previousDate:20260101},{previousDate:20260102}])assert.equal(M.annualChange({...annualBase,...override}),null);
assert.equal(M.annualChange({...annualBase,previousDate:20251231}).days,1);
assert.equal(M.annualChange({...annualBase,p:1e300,previousDate:20251231}).rate,null);
console.log('Annualized change: elapsed days, compound rate, exclusions and overflow passed');

const inactiveCounts=M.summary([{...t,flags:2},{...t,flags:4},{...t,flags:6}]);
assert.equal(inactiveCounts.cancelled,2);assert.equal(inactiveCounts.missing,1);assert.equal(inactiveCounts.count,0);assert.equal(inactiveCounts.inactive,3);

// Previous contract-day range resets after each trading day, not each calendar day.
const rangeTrade={...rising,previousMin:100000,previousMax:120000};
for(const p of [100000,110000,120000]){
 const trade={...rangeTrade,p};
 assert.equal(M.category(trade,'up'),false);
 assert.equal(M.comparison(trade).direction,0);
 assert.equal(M.annualChange(trade),null);
}
assert.equal(M.comparison({...rangeTrade,p:99000}).direction,-1);
assert.equal(M.comparison({...rangeTrade,p:121000}).direction,1);
assert.ok(Math.abs(M.changeRate({...rangeTrade,p:132000})-10)<1e-9);
assert.equal(M.comparison({...rangeTrade,previousMin:110000,previousMax:110000,p:100000}).direction,-1);
assert.equal(M.comparison({...rangeTrade,previousMin:110000,previousMax:110000,p:120000}).direction,1);
assert.equal(M.category({...rangeTrade,previousMax:undefined,p:130000},'up'),false);
console.log('Range comparison: boundaries, reset, rates and legacy-data exclusion passed');

const multi=M.filters(new URLSearchParams({g:' 강북구,중구,강북구 ',q:'단지'}));
assert.equal(multi.g,'강북구,중구');
assert.equal(M.match({...t,c:{...t.c,g:'중구'}},{g:multi.g}),true);
assert.equal(M.match({...t,c:{...t.c,g:'강북구'}},{g:multi.g}),true);
assert.equal(M.match({...t,c:{...t.c,g:'북구'}},{g:multi.g}),false);
assert.equal(M.match({...t,c:{...t.c,g:'종로구'}},{g:multi.g}),false);
const manyDistricts=Array.from({length:82},(_,i)=>'시군구'+i).join(',');
assert.equal(M.filters(new URLSearchParams({g:manyDistricts})).g,manyDistricts);
assert.equal(M.filters(new URLSearchParams({g:', ,'})).g,undefined);
console.log('Daily district union and URL round-trip passed');
