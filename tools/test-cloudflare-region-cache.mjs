import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash,webcrypto} from 'node:crypto';
import {regionModels,rentalFrames,saleFrames,regionPriceAssets} from './build-region-price-cache.mjs';
const root=new URL('../',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),ctx=regionModels(root);
vm.runInContext(readFileSync(new URL('../js/region-price-cache.js',import.meta.url),'utf8'),ctx);
const plain=x=>JSON.parse(JSON.stringify(x));
test('sale frames preserve merged complexes, representative ties and weighted region totals',()=>{
  const catalog={complexes:[{id:'a',r:0},{id:'b',r:0},{id:'c',r:0}],areas:[[0,'84'],[1,'59'],[2,'84']]};
  const payload={d:[{id:'merged',r:0,admin:['41','gu','dong'],memberSources:[{id:'a'},{id:'b'}]},{id:'c',r:0,admin:['41','gu','dong2']}]};
  const file=saleFrames(ctx,catalog,payload,{opening:[[0,20260801,100,100,100,1],[1,20260801,200,200,200,1],[2,20260801,800,800,800,1]],updates:[[0,20260902,300,300,300,1],[2,20260903,900,900,900,1]]},'2026-09');
  for(const [day,expected]of [['2026-09-01',500],['2026-09-03',600],['2026-09-02',550],['2026-09-01',500]]){
    const f=ctx.NodoRegionPrices.frame(file,day);assert.equal(new Map(f.regionSummaries).get('gu').average,expected);assert.equal(f.complexCount,2);
  }
});
test('rental daily deltas keep same-day ID order, missing rates and unmapped apartment points',()=>{
  const catalog=[{id:'a',r:0,coord:[37,127],admin:['41','gu','dong']},{id:'b',r:0,coord:[37,127],admin:['41','gu']},{id:'c',r:0}];
  const row=(ci,date,rent,value,id,area='84')=>[ci,area,date,10000,rent,1,5,0,null,null,null,null,null,value,0,'2026-07',6,id];
  const shard={opening:[row(0,20260801,10,60,'a'),row(1,20260801,20,null,'b'),row(2,20260801,30,80,'c')],updates:[row(0,20260902,40,90,'z'),row(0,20260902,50,100,'y','59')]};
  const file=rentalFrames(ctx,catalog,shard,'2026-09','41','monthly');
  for(const day of ['2026-09-01','2026-09-03','2026-09-02','2026-09-01'])for(const convert of [false,true]){
    const actual=ctx.NodoRegionPrices.frame(file,day,convert),expected=ctx.NodoRentalMapModel.create(catalog).mapView([shard],['41'],{day,type:'monthly',convert,contract:'all',kind:'all',compactMap:true});
    assert.deepEqual(plain(actual.regionSummaries),plain(expected.regionSummaries));assert.equal(actual.count,expected.count);assert.deepEqual(plain(actual.stats),plain(expected.stats));
    assert.equal(actual.points.length,1);assert.equal(actual.points[0].value,convert?null:20);
  }
});
test('only supported default filters can use regional frames',()=>{
  const e=ctx.NodoRegionPrices.eligible;
  assert.equal(e({r:0,searchIds:[]},'sale'),true);assert.equal(e({aL:0},'sale'),false);assert.equal(e({g:'수지구'},'sale'),false);
  assert.equal(e({region:'41',convert:true,contract:'all'},'monthly'),true);
  for(const s of [{areaMin:0},{searchIds:['a']},{contract:'1'},{kind:'high'},{q:'단지'}])assert.equal(e(s,'monthly'),false);
});
test('deposit equivalents are converted per contract before averaging, with missing rates excluded',()=>{
  const catalog=[0,1,2].map(i=>({id:String(i),r:0,coord:[37,127],admin:['31','gu','dong']}));
  const row=(ci,rate)=>[ci,'84',20260801,10000,100,1,5,0,null,null,null,null,null,rate?100+10000*rate/1200:null,0,'2026-07',rate,String(ci)];
  const file=rentalFrames(ctx,catalog,{opening:[row(0,2),row(1,10),row(2,null)],updates:[]},'2026-09','41','monthly');
  const summary=new Map(ctx.NodoRegionPrices.frame(file,'2026-09-01',true).regionSummaries).get('gu');
  assert.equal(summary.depositEquivalentAverage,46000);assert.equal(summary.depositAverage,10000);assert.equal(summary.pricedCount,2);assert.equal(summary.count,3);
  assert.equal(ctx.NodoRental.depositEquivalent({rate:0,value:100,deposit:10000,rent:100}),null);
});
test('reader aborts obsolete months, reuses same-month files and rejects incompatible versions',async()=>{
  const packed={schema:1,opening:{regions:[['41',[2,2,600]]],meta:{complexCount:2}},updates:[]};
  const bytes=gzipSync(JSON.stringify(packed)),digest=createHash('sha256').update(bytes).digest('hex');
  const sources=Object.fromEntries(['08','09'].map(m=>['data/map/price-cache/2026-'+m+'-41-sale.bin',digest]));
  let aborted=false,downloads=0,started,newStarted,releaseNew;const ready=new Promise(r=>started=r),newReady=new Promise(r=>newStarted=r),newGate=new Promise(r=>releaseNew=r);
  const c=vm.createContext({Response,Blob,TextDecoder,DecompressionStream,AbortController,crypto:webcrypto,fetch:async(url,{signal}={})=>{
    if(url.endsWith('index.json'))return Response.json({schema:1,versions:{sale:'v1'},sources});
    downloads++;if(url.includes('2026-08')){started();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true}));}
    if(url.includes('2026-09')){newStarted();await newGate;}
    return new Response(bytes);
  }});
  for(const name of ['verified-data-cache','region-price-cache'])vm.runInContext(readFileSync(new URL('../js/'+name+'.js',import.meta.url),'utf8'),c);
  const client=c.NodoRegionPrices.create(),old=client.get('sale','2026-08-01',['41'],{sale:'v1'});await ready;
  const first=client.get('sale','2026-09-01',['41'],{sale:'v1'});await newReady;const second=client.get('sale','2026-09-02',['41'],{sale:'v1'});releaseNew();const fresh=await second;assert.equal(await first,null);assert.equal(await old,null);assert.equal(aborted,true);assert.equal(fresh.complexCount,2);
  await client.get('sale','2026-09-02',['41'],{sale:'v1'});assert.equal(downloads,2);
  assert.equal(await client.get('sale','2026-09-02',['41'],{sale:'old'}),null);
});
test('rental worker loads regional bundles without downloading apartment state, then falls back for filters',async()=>{
  const catalog=[{id:'a',r:0,coord:[37,127],admin:['31','gu','dong']}];
  const shard={opening:[[0,'84',20260801,10000,20,1,5,0,null,null,null,null,null,70,0,'2026-07',6,'a']],updates:[]};
  const files={},sources={},seen=[];
  const add=(path,value)=>{const raw=Buffer.from(JSON.stringify(value));files[path]=path.endsWith('.bin')?gzipSync(raw):raw;sources[path]=createHash('sha256').update(files[path]).digest('hex');};
  add('data/rental/catalog.bin',{complexes:catalog});add('data/rental/rates.json',{});
  add('data/rental/months/2026-09-41-state.bin',shard);
  const manifest={schema:1,version:'v1',sources:{...sources},months:['2026-09'],historyYears:['2026'],coverage:{}};
  add('data/rental/index.json',manifest);
  const path='data/map/price-cache/2026-09-41-monthly.bin';add(path,rentalFrames(ctx,catalog,shard,'2026-09','41','monthly'));
  add('data/map/price-cache/index.json',{schema:1,versions:{rental:'v1'},rentalMaxDate:'2026-09-18',sources:{[path]:sources[path]}});
  let receive;const c=vm.createContext({Response,Blob,TextDecoder,DecompressionStream,AbortController,crypto:webcrypto,postMessage:v=>receive(v),fetch:async url=>{const p=url.split('?')[0].replace(/^\//,'');seen.push(p);return new Response(files[p],{status:files[p]?200:404});}});
  c.self=c;c.importScripts=(...urls)=>{for(const url of urls)vm.runInContext(readFileSync(new URL('..'+url.split('?')[0],import.meta.url),'utf8'),c);};
  vm.runInContext(readFileSync(new URL('../js/rental-worker.js',import.meta.url),'utf8'),c);
  let id=0;const request=(action,settings)=>new Promise(resolve=>{receive=resolve;c.onmessage({data:{id:++id,action,settings}});});
  const init=await request('init',{map:true});assert.equal(init.meta.lastDate,'2026-09-18');
  const settings={map:true,compactMap:true,zoom:12,day:'2026-09-18',type:'monthly',region:'41',convert:true,kind:'all',contract:'all'};
  const result=await request('view',settings);assert.equal(result.regional,true);assert.equal(new Map(result.regionSummaries).get('gu').average,70);
  assert.equal(seen.some(p=>p.endsWith('-state.bin')),false);assert.equal(seen.some(p=>p==='data/rental/months/2026-09-41.bin'),false);
  const filtered=await request('view',{...settings,areaMin:80});assert.equal(filtered.error,undefined);assert.equal(filtered.regional,undefined);assert.equal(filtered.points.length,1);assert.equal(seen.some(p=>p.endsWith('-state.bin')),true);
});
test('quarter reader reuses months backwards and forwards, promotes prefetch and cancels obsolete work',async()=>{
  const prefix='data/map/price-cache/',sources={},quarterSources={},files={},seen=[];
  const packed=n=>({schema:1,opening:{regions:[['gu',[1,1,n]]],meta:{complexCount:1}},updates:[]});
  for(const type of ['sale','jeonse','monthly'])for(const q of [2,3,4]){
    const months={};for(let n=q*3-2;n<=q*3;n++){const month='2026-'+String(n).padStart(2,'0');months[month]=packed(n);sources[prefix+month+'-41-'+type+'.bin']='a'.repeat(64);}
    const path=prefix+'2026-Q'+q+'-41-'+type+'.bin';files[path]=gzipSync(JSON.stringify({schema:1,months}));quarterSources[path]=createHash('sha256').update(files[path]).digest('hex');
  }
  let release,started,aborted=false;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r);
  const c=vm.createContext({Date,Response,Blob,TextDecoder,DecompressionStream,AbortController,crypto:webcrypto,fetch:async(url,{signal}={})=>{
    if(url.endsWith('index.json'))return Response.json({schema:1,versions:{sale:'v1',rental:'v1'},sources,quarterSources});
    const path=url.slice(1).split('?')[0];seen.push(path);
    if(path.includes('Q3-41-sale')){started();await gate;}
    if(path.includes('Q4-41-sale'))await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true}));
    return new Response(files[path]);
  }});
  for(const name of ['verified-data-cache','region-price-cache'])vm.runInContext(readFileSync(new URL('../js/'+name+'.js',import.meta.url),'utf8'),c);
  const client=c.NodoRegionPrices.create();
  for(const month of ['04','06','05','04']){const value=await client.get('sale','2026-'+month+'-01',['41'],{sale:'v1'});assert.equal(value.regionSummaries[0][1].average,Number(month));}
  await ready;assert.equal(seen.filter(p=>p.includes('Q2')).length,1);assert.equal(seen.filter(p=>p.includes('Q3')).length,1);
  const promoted=client.get('sale','2026-07-01',['41'],{sale:'v1'});release();assert.equal((await promoted).regionSummaries[0][1].average,7);
  assert.equal(seen.filter(p=>p.includes('Q3')).length,1,'foreground shares pending quarter download');
  const rental=await client.get('monthly','2026-04-01',['41'],{rental:'v1'});assert.equal(rental.regionSummaries[0][1].average,4);assert.equal(aborted,true);
  client.cancel();assert.equal(await client.get('monthly','2026-04-01',['41'],{rental:'old'}),null);
});

test('failed quarter prefetch leaves the current frame valid; corrupt foreground bytes are rejected',async()=>{
  const prefix='data/map/price-cache/',path=prefix+'2026-Q2-41-monthly.bin',next=prefix+'2026-Q3-41-monthly.bin';
  const bytes=gzipSync(JSON.stringify({schema:1,months:{'2026-04':{opening:{regions:[],meta:{complexCount:4}},updates:[]}}}));
  let damaged=false;
  const c=vm.createContext({Response,Blob,TextDecoder,DecompressionStream,AbortController,crypto:webcrypto,fetch:async url=>{
    if(url.endsWith('index.json'))return Response.json({schema:1,versions:{rental:'v1'},sources:{[prefix+'2026-04-41-monthly.bin']:'a'.repeat(64)},quarterSources:{[path]:createHash('sha256').update(bytes).digest('hex'),[next]:'b'.repeat(64)}});
    if(url.includes('Q3'))throw Error('offline');return new Response(damaged?'corrupt':bytes);
  }});
  for(const name of ['verified-data-cache','region-price-cache'])vm.runInContext(readFileSync(new URL('../js/'+name+'.js',import.meta.url),'utf8'),c);
  assert.equal((await c.NodoRegionPrices.create().get('monthly','2026-04-01',['41'],{rental:'v1'})).complexCount,4);
  damaged=true;assert.equal(await c.NodoRegionPrices.create().get('monthly','2026-04-01',['41'],{rental:'v1'}),null);
});

test('packaging reuses unchanged bundles, repairs damaged outputs and rejects changed inputs',()=>{
  const fixture=mkdtempSync(join(tmpdir(),'region-price-fixture-'));
  try{
    const write=(p,b)=>{mkdirSync(dirname(join(fixture,p)),{recursive:true});writeFileSync(join(fixture,p),b);};
    for(const p of ['js/map-model.js','js/daily-model.js','js/rental-model.js','js/rental-map-model.js','tools/build-region-price-cache.mjs'])write(p,readFileSync(join(root,p)));
    const saleSources={},rentalSources={},add=(p,value,sources)=>{const raw=Buffer.from(JSON.stringify(value)),bytes=p.endsWith('.bin')?gzipSync(raw):raw;write(p,bytes);sources[p]=createHash('sha256').update(bytes).digest('hex');};
    add('data/daily/catalog.bin',{complexes:[{id:'a',r:0}],areas:[[0,'84']]},saleSources);
    add('data/rental/catalog.bin',{complexes:[{id:'a',r:0,coord:[37,127],admin:['31','gu','dong']}]},rentalSources);
    for(const [r,region]of ['41','11','28'].entries()){
      add(`data/daily/${r}/2026-09-state.bin`,{opening:r?[]:[[0,20260801,100,100,100,1]],updates:[]},saleSources);
      add(`data/rental/months/2026-09-${region}-state.bin`,{opening:[],updates:[]},rentalSources);
      add(`data/rental/months/2026-09-${region}.bin`,{rows:[]},rentalSources);
    }
    write('data/map/index.json',JSON.stringify({meta:{sourceVersion:'map1'},d:[{id:'a',r:0,admin:['31','gu','dong']}]}));
    write('data/daily/index.json',JSON.stringify({version:'sale1',months:['2026-09'],sources:saleSources}));
    write('data/rental/index.json',JSON.stringify({version:'rent1',months:['2026-09'],sources:rentalSources}));
    const first=regionPriceAssets(fixture);assert.equal(first.length,19);assert.deepEqual(regionPriceAssets(fixture),first);
    for(const asset of first.filter(a=>a.path.includes('-Q3-'))){const bundle=JSON.parse(gunzipSync(readFileSync(asset.source)));assert.deepEqual(Object.keys(bundle.months),['2026-09']);const monthly=first.find(a=>a.path===asset.path.replace('2026-Q3','2026-09'));assert.deepEqual(bundle.months['2026-09'],JSON.parse(gunzipSync(readFileSync(monthly.source))));}
    writeFileSync(first[0].source,'damaged output');assert.deepEqual(regionPriceAssets(fixture),first);
    write('data/daily/0/2026-09-state.bin','changed input');assert.throws(()=>regionPriceAssets(fixture),/input mismatch/);
  }finally{assert.ok(fixture.startsWith(join(tmpdir(),'region-price-fixture-')));rmSync(fixture,{recursive:true,force:true});}
});
