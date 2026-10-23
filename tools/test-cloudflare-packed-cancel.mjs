import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {gzipSync} from 'node:zlib';
import {createHash,webcrypto} from 'node:crypto';
import '../js/regional-data.js';
import * as codec from '../js/generated/housing-columns.mjs';
import {packQuarter,encodeQuarter} from '../js/housing-quarter.mjs';
import {packStateTimeline,encodeStateFile} from '../js/housing-state-timeline.mjs';
import {partitionHousing} from './housing-partition.mjs';

const month='2026-07',day=month+'-31';
const scripts=['daily-model.js','verified-data-cache.js','daily-client.js'].map(name=>[name,readFileSync(new URL('../js/'+name,import.meta.url),'utf8')]);

async function fixture({persistent=false,months=[month],regionScopes=[['11110',1],['28110',2]],partitioned=false}={}){
 const files=new Map(),sources={},regions={},quarters={},states={},rentalStates={},requests=[],intercepts=new Map();
 const emitBytes=(path,bytes)=>{files.set(path,bytes);sources[path]=createHash('sha256').update(bytes).digest('hex');};
 const emit=(path,value,binary=false)=>emitBytes(path,binary?gzipSync(value):Buffer.from(JSON.stringify(value)));
 for(const[code,province]of regionScopes){
  const base='data/daily/regions/'+code,identity={complexes:[code+'-A'],areas:[[0,'59']]};
  emit(base+'/identities.json',identity);emit(base+'/metadata.json',{complexes:[{id:code+'-A',n:'A',r:province,g:'구',d:'동',coord:[37.5,127]}]});
  regions[code]={identities:base+'/identities.json',metadata:base+'/metadata.json'};
  quarters[code]={};states[code]={};rentalStates[code]={};
  for(const quarter of new Set(months.map(m=>m.slice(0,4)+'-Q'+Math.ceil(Number(m.slice(5))/3)))){
   const data={};
   for(const m of months.filter(m=>m.slice(0,4)+'-Q'+Math.ceil(Number(m.slice(5))/3)===quarter)){
    const date=Number(m.replace('-','')+'01'),row=[code+':0',date,100,2,0,null,null,null,null,0,'01'.repeat(11),null],rental=[code+':0','59',date,10000,50,1,2,0,null,null,null,null,null,10000,0,null,null,'02'.repeat(10)];
    data[m]={daily:{rows:[row],updates:[[code+':0',date,100,100,100,1]]},rental:{rows:[rental],updates:[rental]}};
    quarters[code][m]=base+'/quarters/'+quarter+'.bin';
   }
   const path=base+'/quarters/'+quarter+'.bin';
   if(partitioned&&code==='11110'){const result=partitionHousing({code,scope:quarter,kind:'quarter',months:data,identity,codec,path,previous:{leaves:[{prefix:'0'},{prefix:'1'}]},emit:emitBytes});for(const m of Object.keys(data))quarters[code][m]=result.path;}
   else emit(path,encodeQuarter(packQuarter(code,quarter,data,identity,codec)),true);
  }
  for(const year of new Set(months.map(m=>m.slice(0,4)))){
   const data=Object.fromEntries(months.filter(m=>m.startsWith(year)).map(m=>[m,[]]));
   for(const kind of ['daily','rental']){
    let path=base+'/states/'+kind+'/'+year+'.bin';
    if(partitioned&&code==='11110')path=partitionHousing({code,scope:year,kind,months:data,identity,codec,path,previous:{leaves:[{prefix:'0'},{prefix:'1'}]},emit:emitBytes}).path;
    else emit(path,encodeStateFile(packStateTimeline(code,kind,data,codec)),true);
    for(const m of Object.keys(data))(kind==='daily'?states:rentalStates)[code][m]=path;
   }
  }
 }
 emit('data/daily/regions/index.json',{schema:3,regions});
 emit('data/rental/rates.json',{rates:{11:{'2026-07':6},28:{'2026-07':6}}});emit('data/rental/summary.json',{});
 for(const kind of ['daily','rental'])files.set('data/'+kind+'/index.json',Buffer.from(JSON.stringify({schema:3,encoding:'gzip-json',version:'test-cancel',months,sources:Object.fromEntries(Object.entries(sources).filter(([p])=>!p.includes('/states/'+(kind==='daily'?'rental':'daily')+'/'))),regional:{format:'packed-region',kind,authority:'data/daily/regions/index.json',quarters,states:kind==='daily'?states:rentalStates}})));
 const fetch=async(url,options={})=>{
  const path=String(url).split('?')[0].replace(/^\//,'');requests.push(path);
  const intercept=intercepts.get(path);if(intercept){intercepts.delete(path);await intercept(options.signal);}
  return new Response(files.get(path),{status:files.has(path)?200:404});
 };
 const stores=new Map(),caches=persistent?{open:async name=>{
  if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);
  return {match:async key=>store.get(key)?.clone(),put:async(key,response)=>{store.set(key,response.clone());},keys:async()=>[...store.keys()],delete:async key=>store.delete(key)};
 }}:undefined;
 const context=()=>{const scope=vm.createContext({console,Response,Blob,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,DataView,DecompressionStream,AbortController,crypto:webcrypto,caches,NodoRegional:globalThis.NodoRegional,fetch});scope.window=scope;scope.self=scope;return scope;};
 const scope=context();
 for(const[name,source]of scripts)vm.runInContext(source,scope,{filename:name});
 const client=await scope.NodoDailyClient.create();
 function blockPath(path){
  let started,aborted;const gate={started:new Promise(resolve=>started=resolve),aborted:new Promise(resolve=>aborted=resolve)};
  gate.wasAborted=false;
  intercepts.set(path,signal=>new Promise((resolve,reject)=>{gate.release=resolve;signal.addEventListener('abort',()=>{gate.wasAborted=true;aborted();reject(signal.reason);},{once:true});started();}));
  return gate;
 }
 const blockState=(code='11110',kind='daily',ym=month)=>blockPath((kind==='daily'?states:rentalStates)[code][ym]);
 function rentalWorker(){
  const scope=context(),pending=new Map();let serial=0;
  scope.postMessage=data=>{if(data.progress)return;pending.get(data.id)?.(data);pending.delete(data.id);};
  scope.importScripts=(...urls)=>{for(const url of urls){if(url.split('?')[0]==='/js/regional-data.js')continue;vm.runInContext(readFileSync(new URL('..'+url.split('?')[0],import.meta.url),'utf8'),scope,{filename:url});}};
  vm.runInContext(readFileSync(new URL('../js/rental-worker.js',import.meta.url),'utf8'),scope,{filename:'rental-worker.js'});
  return(action,settings)=>new Promise(resolve=>{const id=++serial;pending.set(id,resolve);scope.onmessage({data:{id,action,settings}});});
 }
 return{client,requests,intercepts,quarters,states,rentalStates,blockState,blockPath,rentalWorker,reopenDaily:()=>scope.NodoDailyClient.create(),count:path=>requests.filter(p=>p===path).length};
}

test('cancelled packed state is immediately retryable without losing completed quarters or shards',async()=>{
 const f=await fixture(),c=f.client;
 await c.priceFrame(day,{r:2});const completed=await c.month(month,2,true),otherLoads=f.count(f.states['28110'][month]);
 const gate=f.blockState(),old=c.priceFrame(day,{r:1});await gate.started;
 await c.load(f.quarters['11110'][month]);
 c.cancelPrices();const latest=c.priceFrame(day,{r:1});
 const [stale,current]=await Promise.all([old,latest]);
 assert.equal(stale.values.length,0,'cancelled result cannot update the cursor');
 assert.equal(current.values[0].get('11110:0')[4],100);
 assert.equal(f.count(f.states['11110'][month]),2,'aborted state gets a fresh request');
 assert.equal(f.count(f.quarters['11110'][month]),1,'completed quarter is reused');
 assert.equal(await c.month(month,2,true),completed,'completed unrelated shard survives');
 assert.equal(f.count(f.states['28110'][month]),otherLoads);
 const before=f.requests.length;assert.equal((await c.priceFrame(day,{r:1})).values[0].size,1);assert.equal(f.requests.length,before);
});

test('a rapid province change can return to the cancelled packed month immediately',async()=>{
 const f=await fixture(),c=f.client;await c.priceFrame(day,{r:2});
 const gate=f.blockState(),first=c.priceFrame(day,{r:1});await gate.started;
 await c.load(f.quarters['11110'][month]);
 const middle=c.priceFrame(day,{r:2});await gate.aborted;
 const latest=await c.priceFrame(day,{r:1});
 await Promise.all([first,middle]);
 assert.equal(latest.values[0].get('11110:0')[4],100);
 assert.equal(f.count(f.states['11110'][month]),2);
 assert.equal(f.count(f.quarters['11110'][month]),1);
});

test('ordinary packed download failures still reject and remain retryable',async()=>{
 const f=await fixture(),c=f.client,path=f.states['11110'][month];
 f.intercepts.set(path,()=>Promise.reject(Error('temporary network failure')));
 await assert.rejects(c.priceFrame(day,{r:1}),/temporary network failure/);
 assert.equal((await c.priceFrame(day,{r:1})).values[0].get('11110:0')[4],100);
 assert.equal(f.count(path),2);assert.equal(f.count(f.quarters['11110'][month]),1);
});

test('a live rental worker can cancel prefetch and immediately view that packed month',async()=>{
 const f=await fixture(),worker=f.rentalWorker(),settings={type:'monthly',convert:true,map:true,zoom:20,regionCacheDisabled:true,day,period:'month',contract:'all',kind:'all',sort:'value',limit:50};
 assert.equal((await worker('init')).error,undefined);
 const other=await worker('view',{...settings,region:'28'});assert.equal(other.error,undefined);assert.equal(other.points.length,1);
 const otherLoads=f.count(f.rentalStates['28110'][month]),gate=f.blockState('11110','rental');
 const warming=worker('prefetch',{...settings,region:'11',day:'2026-06-30',endMonth:month});await gate.started;
 const quarterLoads=f.count(f.quarters['11110'][month]);
 const cancelled=worker('cancel-prefetch'),latest=worker('view',{...settings,region:'11'});
 const [cancelResult,result,background]=await Promise.all([cancelled,latest,warming]);
 assert.equal(cancelResult.cancelled,true);assert.equal(background.cancelled,true);assert.equal(result.error,undefined);assert.equal(result.points.length,1);
 assert.equal(f.count(f.rentalStates['11110'][month]),2);assert.equal(f.count(f.quarters['11110'][month]),quarterLoads,'quarter buffers survive the cancelled state');
 assert.equal((await worker('view',{...settings,region:'28'})).points.length,1);
 assert.equal(f.count(f.rentalStates['28110'][month]),otherLoads,'unrelated completed state remains reusable');
});

test('reopened sale clients and rental workers reuse the same persisted quarter bytes',async()=>{
 const f=await fixture({persistent:true});await f.client.priceFrame(day,{r:1});
 const path=f.quarters['11110'][month],state=f.states['11110'][month],quarters=f.count(path),states=f.count(state);
 const reopened=await f.reopenDaily();assert.equal((await reopened.priceFrame(day,{r:1})).values[0].size,1);
 assert.equal(f.count(path),quarters);assert.equal(f.count(state),states);
 assert.equal((await f.rentalWorker()('init')).error,undefined);
 assert.equal(f.count(path),quarters,'a separate rental runtime reads the sale-populated quarter cache');
});

const playbackScopes=Array.from({length:6},(_,i)=>[String(11110+i*10),1]);
const playbackMonths=['2026-09','2026-10','2026-12','2027-01','2027-02'];

test('next-month prefetch survives the file limit at quarter and year boundaries',async()=>{
 const f=await fixture({months:playbackMonths,regionScopes:playbackScopes}),c=f.client;
 for(const [date,next]of [['2026-09-30','2026-10-31'],['2026-12-31','2027-01-31'],['2027-01-31','2027-02-28']]){
  await c.priceFrame(date,{r:1});await c.prefetch(date,{r:1},true);
  for(const [code]of playbackScopes)assert.ok(f.count(f.quarters[code][next.slice(0,7)])>0,'next quarter is downloaded before the next frame');
  const before=f.requests.length,frame=await c.priceFrame(next,{r:1},date);
  assert.equal(frame.values[0].size,playbackScopes.length);
  assert.equal(f.requests.length,before,'next frame consumes the warmed quarter and annual state');
 }
});

test('prefetch preserves an active foreground read and is promoted without downloading again',async()=>{
 const f=await fixture({months:playbackMonths,regionScopes:playbackScopes}),c=f.client;
 const current=f.blockState('11110','daily','2026-12'),frame=c.priceFrame('2026-12-31',{r:1});await current.started;
 await c.prefetch('2026-12-31',{r:1},true);
 assert.equal(current.wasAborted,false,'warming the next year does not evict the active year');
 current.release();assert.equal((await frame).values[0].size,playbackScopes.length);
 const before=f.requests.length;assert.equal((await c.priceFrame('2027-01-31',{r:1})).values[0].size,playbackScopes.length);
 assert.equal(f.requests.length,before);
});

test('cancel aborts an obsolete map quarter but preserves an unrelated foreground download',async()=>{
 const f=await fixture({months:playbackMonths,regionScopes:playbackScopes}),c=f.client;
 const other=f.blockPath(f.quarters['11110']['2026-09']),otherRead=c.load(f.quarters['11110']['2026-09']);await other.started;
 const current=f.blockPath(f.quarters['11110']['2026-12']),frame=c.priceFrame('2026-12-31',{r:1});await current.started;
 c.cancelPrices();await current.aborted;
 assert.equal(other.wasAborted,false,'a separate transaction download is not owned by the cancelled map');
 other.release();await otherRead;assert.equal((await frame).values.length,0);
 assert.equal((await c.priceFrame('2026-12-31',{r:1})).values[0].size,playbackScopes.length);
 assert.equal(f.count(f.quarters['11110']['2026-12']),2);
});

for(const action of ['new date','cancel'])test(action+' aborts obsolete prefetch and permits an immediate retry',async()=>{
 const f=await fixture({months:playbackMonths,regionScopes:playbackScopes}),c=f.client;
 await c.priceFrame('2026-12-31',{r:1});
 const pending=f.blockState('11110','daily','2027-01'),warm=c.prefetch('2026-12-31',{r:1},true);await pending.started;
 if(action==='cancel')c.cancelPrices();else await c.priceFrame('2026-09-30',{r:1});
 await pending.aborted;await warm;
 assert.equal((await c.priceFrame('2027-01-31',{r:1})).values[0].size,playbackScopes.length);
 assert.equal(f.count(f.states['11110']['2027-01']),2,'obsolete annual state is retried');
});

test('partition leaves and order files are protected, cancelled, and immediately retryable',async()=>{
 for(const target of ['quarters/2027-Q1-p0.bin','quarters/2027-Q1-order.bin','states/daily/2027-p0.bin','states/daily/2027-order.bin']){
  const f=await fixture({months:playbackMonths,regionScopes:playbackScopes,partitioned:true}),c=f.client;
  await c.priceFrame('2026-12-31',{r:1});
  const path='data/daily/regions/11110/'+target,pending=f.blockPath(path),warm=c.prefetch('2026-12-31',{r:1},true);await pending.started;
  assert.equal(pending.wasAborted,false,'partition member survives prefetch cache pressure');
  c.cancelPrices();await pending.aborted;await warm;
  await c.priceFrame('2026-12-31',{r:1});await c.prefetch('2026-12-31',{r:1},true);
  const before=f.requests.length;assert.equal((await c.priceFrame('2027-01-31',{r:1})).values[0].size,playbackScopes.length);
  assert.equal(f.requests.length,before,'all partition members are warm');
  assert.equal(f.count(path),2,target);
 }
});
