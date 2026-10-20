import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../trades/index.html',import.meta.url),'utf8');
const between=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const page=(number,rows,{pages=3,total=3}={})=>({ok:true,status:200,json:async()=>({meta:{page:number,pages,total},data:rows})});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(fetch){
 const nodes=new Map(),context=vm.createContext({
  AbortController,fetch,DATA_BASE:'/data/market',getRegion:()=> 'seoul',monthToLabel:ym=>ym,
  computeSummary:data=>({count:data.length,avg:10000,avgPp:1000,median:10000,max:10000,min:10000}),
  formatPrice:String,formatPyeongPrice:String,
  document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,{style:{},textContent:'',disabled:false});return nodes.get(id);}}
 });
 vm.runInContext([
  between('const state = {','// ==================== UTILS'),
  between('async function loadMonth(ym)','// ==================== FILTERING'),
  between('function updateSummary(data)','function renderTable(data)'),
  between('function updateDataInfo()','function updateSortIcons()'),
  'function render(){updateSummary(state.allData);updateDataInfo();}',
  'function renderEmpty(message){document.getElementById("empty").textContent=message;}',
  'globalThis.api={state,loadMonth,loadNextPage,emptyTradesMessage};'
 ].join('\n'),context);
 return {...context.api,node:id=>nodes.get(id)};
}
const ids=h=>Array.from(h.state.allData,r=>r.id);

test('partial failure preserves successful pages and retries only missing pages without duplicates',async()=>{
 const calls=[];let fail=true;
 const h=harness(async url=>{
  const n=Number(url.match(/\/(\d+)\.json$/)[1]);calls.push(n);
  if(n===2&&fail)return {ok:false,status:503};
  return page(n,[{id:'page-'+n}]);
 });
 await h.loadMonth('2026-09');
 assert.deepEqual(ids(h),['page-1','page-3']);
 assert.equal(h.state.loadedPages,2);assert.equal(h.state.allPagesLoaded,false);
 assert.equal(h.node('sumAvg').textContent,'자료 미완료');
 assert.match(h.node('loadStatus').textContent,/1개 페이지를 받지 못/);
 assert.equal(h.node('loadMoreBtn').style.display,'block');assert.equal(h.node('loadMoreBtn').disabled,false);
 fail=false;await h.loadNextPage();
 assert.deepEqual(calls,[1,2,3,2]);assert.deepEqual(ids(h),['page-1','page-2','page-3']);
 assert.equal(h.state.loadedPages,3);assert.equal(h.state.allPagesLoaded,true);
 assert.equal(h.node('loadStatus').textContent,'');assert.equal(h.node('loadMoreBtn').style.display,'none');
 assert.notEqual(h.node('sumAvg').textContent,'자료 미완료');
});

test('a first-page failure offers retry; only a first-page 404 is an empty month',async()=>{
 let response={ok:false,status:500};
 const h=harness(async()=>response);
 await h.loadMonth('2026-09');
 assert.equal(h.state.allPagesLoaded,false);assert.equal(h.state.loadedPages,0);
 assert.equal(h.node('loadMoreBtn').style.display,'block');
 assert.equal(h.node('dataInfo').textContent,'자료 미완료');
 assert.match(h.emptyTradesMessage(),/자료를 받지 못/);
 response=page(1,[{id:'recovered'}],{pages:1,total:1});await h.loadNextPage();
 assert.deepEqual(ids(h),['recovered']);assert.equal(h.state.allPagesLoaded,true);
 response={ok:false,status:404};await h.loadMonth('2026-11');
 assert.deepEqual(ids(h),[]);assert.equal(h.state.allPagesLoaded,true);
 assert.equal(h.node('sumTotal').textContent,'0건');assert.equal(h.node('loadMoreBtn').style.display,'none');
 assert.match(h.node('empty').textContent,/이 달의 데이터가 없습니다/);
 assert.equal(h.emptyTradesMessage(),'이 달의 데이터가 없습니다');
});

test('a later-page 404 or invalid body stays incomplete and can be retried',async()=>{
 for(const bad of [{ok:false,status:404},{ok:true,status:200,json:async()=>{throw Error('truncated JSON');}},page(3,[])]){
  let fail=true;const h=harness(async url=>url.endsWith('/1.json')?page(1,[{id:'first'}],{pages:2,total:2}):fail?bad:page(2,[{id:'second'}],{pages:2,total:2}));
  await h.loadMonth('2026-09');assert.equal(h.state.allPagesLoaded,false);assert.deepEqual(ids(h),['first']);
  fail=false;await h.loadNextPage();assert.equal(h.state.allPagesLoaded,true);assert.deepEqual(ids(h),['first','second']);
 }
});

test('old first-page JSON cannot overwrite a new month even when abort arrives too late',async()=>{
 const body=deferred();let oldSignal;
 const h=harness(async(url,{signal})=>{
  if(url.includes('2026-09')){oldSignal=signal;return {ok:true,status:200,json:()=>body.promise};}
  return page(1,[{id:'October'}],{pages:1,total:1});
 });
 const old=h.loadMonth('2026-09');await tick();
 await h.loadMonth('2026-10');assert.equal(oldSignal.aborted,true);
 body.resolve({meta:{page:1,pages:1,total:1},data:[{id:'September'}]});await old;
 assert.equal(h.state.month,'2026-10');assert.deepEqual(ids(h),['October']);
 assert.equal(h.state.allPagesLoaded,true);assert.equal(h.state.loading,false);
});

test('returning to the same month starts a distinct request and clears old rows immediately',async()=>{
 const oldBody=deferred();let september=0;
 const h=harness(async url=>{
  if(url.includes('2026-09')&&++september===1)return {ok:true,status:200,json:()=>oldBody.promise};
  return page(1,[{id:url.includes('2026-10')?'October':'new September'}],{pages:1,total:1});
 });
 const old=h.loadMonth('2026-09');await tick();await h.loadMonth('2026-10');
 const current=h.loadMonth('2026-09');assert.deepEqual(ids(h),[]);await current;
 oldBody.resolve({meta:{page:1,pages:1,total:1},data:[{id:'old September'}]});await old;
 assert.deepEqual(ids(h),['new September']);
});

test('stale background failures cannot clear the new loading state or show a retry for the wrong month',async()=>{
 const oldPage=deferred(),newPage=deferred();
 const h=harness(async url=>{
  if(url.includes('2026-10'))return newPage.promise;
  return url.endsWith('/1.json')?page(1,[{id:'September'}],{pages:2,total:2}):oldPage.promise;
 });
 const old=h.loadMonth('2026-09');await tick();const current=h.loadMonth('2026-10');
 assert.equal(h.node('dataInfo').textContent,'자료를 불러오는 중…');
 assert.equal(h.emptyTradesMessage(),'자료를 불러오는 중…');
 oldPage.resolve({ok:false,status:503});await old;
 assert.equal(h.state.loading,true);assert.equal(h.state.allPagesLoaded,false);assert.deepEqual(ids(h),[]);
 assert.equal(h.node('loadMoreBtn').style.display,'none');
 newPage.resolve(page(1,[{id:'October'}],{pages:1,total:1}));await current;
 assert.deepEqual(ids(h),['October']);assert.equal(h.node('loadStatus').textContent,'');
});

test('only three trailing pages run at once and repeated retry clicks do not duplicate requests',async()=>{
 const pending=[],calls=[];let active=0,peak=0;
 const h=harness(async url=>{
  const n=Number(url.match(/\/(\d+)\.json$/)[1]);calls.push(n);
  if(n===1)return page(n,[{id:n}],{pages:5,total:5});
  active++;peak=Math.max(peak,active);const gate=deferred();pending.push(gate);await gate.promise;active--;
  return page(n,[{id:n}],{pages:5,total:5});
 });
 const work=h.loadMonth('2026-09');await tick();assert.equal(active,3);
 await h.loadNextPage();assert.deepEqual(calls,[1,2,3,4]);
 pending[0].resolve();await tick();assert.equal(active,3);
 for(const gate of pending)gate.resolve();await work;
 assert.equal(peak,3);assert.deepEqual(calls,[1,2,3,4,5]);assert.equal(h.state.allPagesLoaded,true);
 assert.deepEqual(ids(h),[1,2,3,4,5]);
});
