import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const main=read('js/main-app.js');

for(const page of ['home','compare'])test(page+' boot loads annual prices without legacy detail assets',async()=>{
 const requests=[],elements=new Map();
 const ctx={URLSearchParams,performance:{now:()=>0},console:{log(){},warn(){}},setTimeout(){},
  location:{search:''},D:[],Y:[2024,2025],retYearFrom:2024,retYearTo:2025,dataLastMonth:12,
  PRICES:null,VOLUMES:null,DETAILS:null,GEO_DATA:null,areaCache:{},selectedAreas:[],
  APT_BASE:page==='compare'?'../':'',loadAptIndex:async()=>({}),
  fetch:async path=>{requests.push(path);return {ok:true,json:async()=>({'7':[100,110]})};},
  document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{style:{}});return elements.get(id);}},
 };
 for(const name of ['applyIndexPayload','updateLifecycleCounts','initReturnYearSelects','buildLoc','buildMerged','syncPriceMetricButtons','af','bindHomeSearch','loadCompareHash','setAreaLevel','buildAreaGuFilter','bindCompareSearch','renderAreaList','renderComparison'])ctx[name]=()=>{};
 ctx.loadHash=()=>false;ctx.window=ctx;vm.createContext(ctx);
 vm.runInContext(read('js/data-loader.js'),ctx);
 vm.runInContext(read('js/calc-utils.js'),ctx);
 if(page==='home'){
  const source=main.slice(main.indexOf('async function init(){'),main.indexOf('function initReturnYearSelects(){'));
  await vm.runInContext(source+';init();',ctx);
 }else{
  const html=read('compare/index.html'),start=html.indexOf('(async function(){');
  await vm.runInContext(html.slice(start,html.indexOf('})();',start)+5),ctx);
 }
 await settle();
 assert.deepEqual(requests,[ctx.APT_BASE+'data/prices.json']);
 assert.equal(ctx.VOLUMES,null);assert.equal(ctx.DETAILS,null);assert.equal(ctx.GEO_DATA,null);
 assert.ok(Math.abs(ctx.calcReturnObj({i:7}).val-10)<1e-9);
 assert.equal(elements.get('app').style.display,'block');
});

test('search and comparison selections still use the shared apartment detail',()=>{
 const calls=[],ctx={NodoApartmentLinks:{go:value=>calls.push(value)}};ctx.window=ctx;
 const source=main.slice(main.indexOf('function showDetail(x){'),main.indexOf('function switchAreaFromMerged('));
 vm.runInNewContext(source+';showDetail({as:"11200-35",i:7,a:84});',ctx);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{id:'11200-35',row:7,area:84}]);
});

async function activity(rows){
 const elements=new Map(),requests=[],errors=[];
 class Element{
  constructor(){this.children=[];this.dataset={};this.textContent='';}
  set id(value){this._id=value;elements.set(value,this);}get id(){return this._id;}
  set innerHTML(value){this.html=value;for(const match of value.matchAll(/id="([^"]+)"/g)){const child=new Element();child.id=match[1];}}
  get innerHTML(){return this.html||'';}
  append(...nodes){this.children.push(...nodes);}prepend(...nodes){this.children.unshift(...nodes);}
  replaceChildren(...nodes){this.children=nodes;this.textContent='';}
  querySelectorAll(){return [];}
 }
 const root=new Element();root.id='main-content';
 const assets={
  '/data/apartments/index.json':{lookup:{public:['public','ab']},legacy:{7:['public',84]}},
  '/data/apartments/summary/ab.json':{public:{id:'public',name:'테스트 단지'}},
 };
 const ctx={URLSearchParams,console:{error:e=>errors.push(e)},Event:class{},
  location:{pathname:'/account/',search:''},MutationObserver:class{observe(){}},
  document:{getElementById:id=>elements.get(id)||null,createElement:()=>new Element(),
   querySelector:s=>s==='#main-content .page-body'?root:null,querySelectorAll:()=>[],
   addEventListener(){},dispatchEvent(){},body:new Element()},
  NodoAPI:{getState:async()=>({session:{user:{id:'member'}}}),onChange(){},
   request:async path=>{assert.match(path,/^\/api\/me\/activity\?/);return {data:rows};}},
  fetch:async path=>{requests.push(path);assert.ok(assets[path],path);return {ok:true,json:async()=>assets[path]};},
 };
 // Binary summary transport is covered by test-cloudflare-apartment-records.
 // This fixture checks account routing independently of module loading.
 ctx.testSummary=async()=>({id:'public',name:'테스트 단지'});
 ctx.window=ctx;vm.runInNewContext(read('js/member-library.js').replace("(await import('./apartment-records.mjs')).apartmentSummary(id)",'testSummary(id)'),ctx);await settle();
 assert.deepEqual(errors,[]);
 const box=elements.get('activity-list');assert.ok(box);
 assert.doesNotMatch(box.innerHTML,/다시 시도/);
 return {requests,box};
}
const row=(id,page_id)=>({id,page_id,created_at:'2026-10-23',content:'활동 내용'});

test('empty and non-apartment account activity need no apartment files',async()=>{
 const empty=await activity([]);assert.deepEqual(empty.requests,[]);assert.match(empty.box.textContent,/아직 표시할 활동이 없습니다/);
 const other=await activity([row(1,'community'),row(2,'company_005930'),row(3,'div')]);
 assert.deepEqual(other.requests,[]);assert.equal(other.box.children.length,3);
 assert.match(other.box.children[0].innerHTML,/\/board\/\?post=1&amp;comment=1/);
 assert.match(other.box.children[1].innerHTML,/\/div\/\?company=005930&amp;comment=2/);
});

test('apartment activity retains labels and comment links and shares its legacy catalog download',async()=>{
 const result=await activity([row(1,'community'),row(2,'apt_7'),row(3,'apt_7')]);
 assert.deepEqual(result.requests,['/data/apartments/index.json']);
 assert.equal(result.box.children.length,3);
 assert.match(result.box.children[1].innerHTML,/테스트 단지 · 84㎡/);
 assert.match(result.box.children[1].innerHTML,/\/apartment\/\?id=public&amp;area=84&amp;tab=comments&amp;commentSource=apt_7&amp;comment=2/);
 assert.match(result.box.children[2].innerHTML,/comment=3/);
});
