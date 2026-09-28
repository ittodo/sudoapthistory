import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {compactMarketShard,rentalMarketAssets} from './build-rental-market-cache.mjs';
const root=resolve(import.meta.dirname,'..');
const ctx=vm.createContext({URLSearchParams});vm.runInContext(readFileSync(join(root,'js/market-rental-model.js'),'utf8'),ctx);const M=ctx.NodoMarketRental;
const cat=[{id:'a',publicId:'p',r:1,g:'종로구',n:'테스트',d:'창신동'},{id:'b',r:0,g:'수원시',n:'다른 단지',d:'매탄동'}];
const s={type:'monthly',region:'',gus:[],contract:'all',q:'',from:2026,to:2026,ref:'2026-09',metric:'monthly',pm:'total',tier:'off'};
const row=(deposit,rent,rate=6,area=33.05785,ci=0,contract=1)=>[ci,area,20260901,deposit,rent,contract,3,rate,'2026-07','r'];
test('both equivalents, weighted prices, exact median, per-transaction area and exclusions',()=>{
  const rows=[row(10000,50),row(20000,50,6,66.1157),row(10000,100,null),row(10000,150,6,0)];const g=M.aggregate(rows,cat,s).total;
  assert.equal(g.count,4);assert.equal(g.excluded,1);assert.equal(g.monthly.avg,150);assert.equal(g.monthly.median,150);assert.equal(g.deposit.median,30000);
  assert.equal(g.monthly.ppCount,2);assert.ok(Math.abs(g.monthly.ppAvg-8.75)<1e-9);assert.equal(g.deposit.avg,30000);
  assert.equal(g.monthly.detail.reduce((n,b)=>n+b.count,0)+g.excluded,g.count);assert.equal(g.deposit.detail.reduce((n,b)=>n+b.count,0)+g.excluded,g.count);
  assert.equal(M.values(row(10000,0,null),'jeonse').deposit,10000);assert.equal(M.values(row(10000,50,0),'monthly').deposit,null);
});
test('even median and price bands include upper boundary',()=>{
  assert.equal(M.aggregate([row(0,100),row(0,200)],cat,s).total.monthly.median,150);
  assert.deepEqual(Array.from([50,100,200,300,301].map(v=>M.tier(v,M.boundaries('monthly','monthly','detail')))),[0,1,2,3,4]);
  assert.equal(M.tier(30000,M.boundaries('jeonse','deposit','simple')),0);
  assert.equal(M.tier(50000,M.boundaries('monthly','deposit','simple')),1);
});
test('every filter restricts the same aggregate and pooled median is not a mean of district medians',()=>{
  const rows=[row(0,10),row(0,20),row(0,30),row(0,1000,6,33.05785,1,2)];
  assert.equal(M.aggregate(rows,cat,s).total.monthly.median,25);
  for(const filter of [{region:'41'},{gus:['수원시']},{contract:'2'},{q:'다른'},{searchIds:['b']},{rentMin:'900'},{areaMin:'30',areaMax:'34',depositMax:'0',rentMin:'999',rentMax:'1001'}])assert.equal(M.aggregate(rows,cat,{...s,...filter}).total.count,1);
  assert.equal(M.aggregate(rows,cat,{...s,areaMax:'10'}).total.count,0);
  assert.equal(M.aggregate(rows,cat,{...s,type:'jeonse'}).total.count,0);
});
test('legacy month slots are converted from sale epoch, filters and new metric survive links',()=>{
  const meta={months:['2011-01','2026-09'],saleStartYear:2006};
  const state=M.normalize(new URL('https://test/market/?tenure=monthly&rentPeriod=day&rentDate=2026-09-01&marketRentMetric=deposit#r=seoul&from=2022&to=2026&m=248'),meta);
  assert.equal(state.ref,'2026-09');assert.equal(state.metric,'deposit');assert.equal(state.region,'11');assert.equal(state.from,2022);
  assert.equal(M.normalize(new URL('https://test/?tenure=jeonse#from=2022&to=2026&m=248&mExact=1'),meta).ref,'2026-09');
  assert.equal(M.normalize(new URL('https://test/?tenure=jeonse#from=2006&to=2010&m=1'),meta).ref,'2011-01');
});
const hash=b=>createHash('sha256').update(b).digest('hex');
function sourceRow(r,cancelled=0){return [r[0],r[1],r[2],r[3],r[4],r[5],r[6],cancelled,null,null,null,null,null,null,0,r[8],r[7],r[9]];}
test('generated compact assets exclude cancelled contracts and invalidate on changed source',()=>{
  const dir=mkdtempSync(join(tmpdir(),'nodo-market-'));try{
    mkdirSync(join(dir,'data/rental/months'),{recursive:true});const input='data/rental/months/2026-09-11.bin';
    const write=rows=>{const bytes=gzipSync(JSON.stringify({rows}));writeFileSync(join(dir,input),bytes);writeFileSync(join(dir,'data/rental/index.json'),JSON.stringify({version:'v1',months:['2026-09'],sources:{[input]:hash(bytes)}}));};
    write([sourceRow(row(10000,50)),sourceRow(row(20000,100),1)]);const first=rentalMarketAssets(dir),a=first.find(f=>f.source);assert.equal(JSON.parse(gunzipSync(readFileSync(a.source))).rows.length,1);const old=a.sha256;
    assert.equal(rentalMarketAssets(dir)[0].sha256,old);write([sourceRow(row(30000,50))]);assert.notEqual(rentalMarketAssets(dir)[0].sha256,old);
    writeFileSync(join(dir,input),Buffer.from('corrupt'));assert.throws(()=>rentalMarketAssets(dir),/hash mismatch/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
function workerHarness({storage,months=['2025-09','2026-08','2026-09']}={}){
  const files={},sources={},pending=new Map(),fetched=[];let sequence=0;const gates=new Map();
  const add=(p,v)=>{const b=p.endsWith('.bin')?gzipSync(JSON.stringify(v)):Buffer.from(JSON.stringify(v));files[p]=b;sources[p]=hash(b);};
  add('data/rental/catalog.bin',{complexes:cat});
  for(const month of months)for(const region of ['11','41','28'])add(`data/rental/months/${month}-${region}.bin`,{rows:region==='11'?[sourceRow(row(10000,50)),sourceRow(row(10000,50),1),sourceRow(row(10000,80,null))]:[]});
  files['data/rental/index.json']=Buffer.from(JSON.stringify({schema:1,version:'v1',months,sources}));
  const context=vm.createContext({console,Response,Blob,TextDecoder,DecompressionStream,AbortController,crypto:webcrypto,caches:storage,fetch:async url=>{const p=String(url).split('?')[0].replace(/^\//,'');fetched.push(p);if(gates.has(p)){const g=gates.get(p);gates.delete(p);await g;}return new Response(files[p]||'',{status:files[p]?200:404});},postMessage:data=>{if(!data.progress){pending.get(data.id)?.(data);pending.delete(data.id);}}});context.self=context;context.importScripts=(...paths)=>paths.forEach(p=>vm.runInContext(readFileSync(join(root,p.split('?')[0]),'utf8'),context));vm.runInContext(readFileSync(join(root,'js/market-rental-worker.js'),'utf8'),context);
  return {files,sources,fetched,add,gates,request:(action,settings)=>new Promise(resolve=>{const id=++sequence;pending.set(id,resolve);context.onmessage({data:{id,action,settings}});})};
}
test('worker preserves counts, reuses both metric aggregates, filters rows and reports unavailable months',async()=>{
  const w=workerHarness();assert.ok((await w.request('init')).meta);const first=await w.request('view',s);assert.equal(first.error,undefined);assert.equal(first.data['2026-09'].total.count,2);assert.equal(first.rowCount,2);assert.equal(first.data['2026-09'].total.excluded,1);assert.equal(first.data['2026-01'].available,0);
  const fetches=w.fetched.length;const toggled=await w.request('view',{...s,metric:'deposit',pm:'pyeong',tier:'detail'});assert.equal(toggled.rowCount,2);assert.equal(w.fetched.length,fetches);
  const filtered=await w.request('view',{...s,rentMin:'70'});assert.equal(filtered.rowCount,1);assert.equal(filtered.data['2026-09'].total.count,1);
});
test('worker supersedes old requests and retries failed files',async()=>{
  const w=workerHarness();await w.request('init');const path='data/rental/months/2026-09-11.bin';let release;w.gates.set(path,new Promise(r=>release=r));
  const old=w.request('view',s);await new Promise(resolve=>{const check=()=>w.fetched.includes(path)?resolve():setImmediate(check);check();});
  const next=w.request('view',{...s,region:'41'});const n=await next;assert.equal(n.rowCount,0);release();assert.equal((await old).stale,true);
  const retry=workerHarness();await retry.request('init');const saved=retry.files[path];retry.files[path]=Buffer.from('broken');const bad=await retry.request('view',{...s,q:'테스트'});assert.ok(bad.error);retry.files[path]=saved;assert.equal((await retry.request('view',{...s,q:'테스트'})).rowCount,2);
});
test('worker reads verified compact assets and rejects corrupt bytes',async()=>{
  const setup=()=>{const w=workerHarness(),derived={};for(const [path,bytes]of Object.entries(w.files)){if(!/months\/.*\.bin$/.test(path))continue;const target=path.replace('/months/','/market-cache/');w.add(target,compactMarketShard(JSON.parse(gunzipSync(bytes))));derived[target]=w.sources[target];}
    w.files['data/rental/market-cache/index.json']=Buffer.from(JSON.stringify({schema:1,sourceVersion:'v1',inputs:JSON.parse(w.files['data/rental/index.json']).sources,sources:derived,saleStartYear:2006}));return w;};
  const w=setup();await w.request('init');const r=await w.request('view',s);assert.equal(r.error,undefined);assert.equal(r.rowCount,2);assert.ok(w.fetched.some(p=>p.includes('market-cache/')&&p.endsWith('.bin')));assert.equal(w.fetched.some(p=>p.includes('/months/')),false);
  const broken=setup();broken.files['data/rental/market-cache/2026-09-11.bin']=Buffer.from('changed');await broken.request('init');assert.ok((await broken.request('view',s)).error);
});

function browserStorage(){
  const entries=new Map(),store={match:async k=>entries.has(k)?new Response(entries.get(k)):undefined,put:async(k,v)=>{const bytes=Buffer.from(await v.arrayBuffer());entries.delete(k);entries.set(k,bytes);},keys:async()=>[...entries.keys()],delete:async k=>entries.delete(k)};
  return {open:async()=>store,entries};
}
function addCompact(w){
  const derived={};for(const [p,b]of Object.entries(w.files)){if(!p.includes('/months/'))continue;const target=p.replace('/months/','/market-cache/');w.add(target,compactMarketShard(JSON.parse(gunzipSync(b))));derived[target]=w.sources[target];}
  const source=JSON.parse(w.files['data/rental/index.json']);w.files['data/rental/market-cache/index.json']=Buffer.from(JSON.stringify({schema:1,sourceVersion:source.version,inputs:source.sources,sources:derived,saleStartYear:2006}));return w;
}
test('all 567 month files survive filtering, revisiting months and worker recreation',async()=>{
  const storage=browserStorage(),months=Array.from(M.months('2011-01','2026-09')),settings={...s,from:2011};
  const w=addCompact(workerHarness({storage,months}));await w.request('init');assert.equal((await w.request('view',settings)).rowCount,2);
  assert.equal(w.fetched.filter(p=>p.includes('/market-cache/')&&p.endsWith('.bin')).length,567);
  const count=w.fetched.length;
  for(const changes of [{rentMin:'70'},{region:'11'},{ref:'2011-01'},{metric:'deposit'},{}])assert.equal((await w.request('view',{...settings,...changes})).error,undefined);
  assert.equal(w.fetched.length,count,'filter and reference changes reuse disk files after raw-row eviction');
  const fresh=addCompact(workerHarness({storage,months}));await fresh.request('init');assert.equal((await fresh.request('view',{...settings,type:'jeonse'})).error,undefined);
  assert.equal(fresh.fetched.filter(p=>p.endsWith('.bin')).length,0,'reload/type navigation reuse catalog and full history');
  const damaged='data/rental/market-cache/2011-01-11.bin';storage.entries.set('/'+damaged+'?v='+fresh.sources[damaged],Buffer.from('broken'));
  const repair=addCompact(workerHarness({storage,months}));await repair.request('init');assert.equal((await repair.request('view',settings)).error,undefined);
  assert.deepEqual(repair.fetched.filter(p=>p.endsWith('.bin')),[damaged],'only corrupt file is downloaded again');
  const updated=workerHarness({storage,months}),input='data/rental/months/2011-01-11.bin';updated.add(input,{rows:[sourceRow(row(30000,100))]});
  const source=JSON.parse(updated.files['data/rental/index.json']);source.version='v2';source.sources[input]=updated.sources[input];updated.files['data/rental/index.json']=Buffer.from(JSON.stringify(source));addCompact(updated);
  await updated.request('init');const changed=await updated.request('view',{...settings,ref:'2011-01'});assert.equal(changed.rowCount,1);assert.equal(changed.rows[0].deposit,30000);
  assert.deepEqual(updated.fetched.filter(p=>p.endsWith('.bin')),[damaged],'a new source version downloads only the changed shard');
});
test('original fallback files are also retained across workers',async()=>{
  const storage=browserStorage(),months=Array.from(M.months('2025-01','2026-09'));
  const w=workerHarness({storage,months});await w.request('init');await w.request('view',{...s,from:2025});
  const fresh=workerHarness({storage,months});await fresh.request('init');await fresh.request('view',{...s,from:2025,rentMin:'70'});
  assert.equal(fresh.fetched.filter(p=>p.endsWith('.bin')).length,0);
});
test('a metric change during download shares the pending file instead of cancelling it',async()=>{
  const w=workerHarness();await w.request('init');const path='data/rental/months/2026-09-11.bin';let release;
  w.gates.set(path,new Promise(r=>release=r));const old=w.request('view',s);
  await new Promise(resolve=>{const check=()=>w.fetched.includes(path)?resolve():setImmediate(check);check();});
  const next=w.request('view',{...s,metric:'deposit'});release();
  assert.equal((await old).stale,true);assert.equal((await next).rowCount,2);
  assert.equal(w.fetched.filter(p=>p===path).length,1,'the interrupted UI request does not restart its shared download');
});
