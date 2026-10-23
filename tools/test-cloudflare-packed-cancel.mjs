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

const month='2026-07',day=month+'-31';
const scripts=['daily-model.js','verified-data-cache.js','daily-client.js'].map(name=>[name,readFileSync(new URL('../js/'+name,import.meta.url),'utf8')]);

async function fixture({persistent=false}={}){
 const files=new Map(),sources={},regions={},quarters={},states={},rentalStates={},requests=[],intercepts=new Map();
 const emit=(path,value,binary=false)=>{const bytes=binary?gzipSync(value):Buffer.from(JSON.stringify(value));files.set(path,bytes);sources[path]=createHash('sha256').update(bytes).digest('hex');};
 for(const[code,province]of [['11110',1],['28110',2]]){
  const base='data/daily/regions/'+code,identity={complexes:[code+'-A'],areas:[[0,'59']]};
  emit(base+'/identities.json',identity);emit(base+'/metadata.json',{complexes:[{id:code+'-A',n:'A',r:province,g:'구',d:'동',coord:[37.5,127]}]});
  regions[code]={identities:base+'/identities.json',metadata:base+'/metadata.json'};
  const q=base+'/quarters/2026-Q3.bin',s=base+'/states/daily/2026.bin',row=[code+':0',20260701,100,2,0,null,null,null,null,0,'01'.repeat(11),null];
  const rental=[code+':0','59',20260701,10000,50,1,2,0,null,null,null,null,null,10000,0,null,null,'02'.repeat(10)];
  emit(q,encodeQuarter(packQuarter(code,'2026-Q3',{[month]:{daily:{rows:[row],updates:[[code+':0',20260701,100,100,100,1]]},rental:{rows:[rental],updates:[rental]}}},identity,codec)),true);
  emit(s,encodeStateFile(packStateTimeline(code,'daily',{[month]:[]},codec)),true);
  quarters[code]={[month]:q};states[code]={[month]:s};
  const rentalState=base+'/states/rental/2026.bin';emit(rentalState,encodeStateFile(packStateTimeline(code,'rental',{[month]:[]},codec)),true);rentalStates[code]={[month]:rentalState};
 }
 emit('data/daily/regions/index.json',{schema:3,regions});
 emit('data/rental/rates.json',{rates:{11:{'2026-07':6},28:{'2026-07':6}}});emit('data/rental/summary.json',{});
 for(const kind of ['daily','rental'])files.set('data/'+kind+'/index.json',Buffer.from(JSON.stringify({schema:3,encoding:'gzip-json',version:'test-cancel',months:[month],sources:Object.fromEntries(Object.entries(sources).filter(([p])=>!p.includes('/states/'+(kind==='daily'?'rental':'daily')+'/'))),regional:{format:'packed-region',kind,authority:'data/daily/regions/index.json',quarters,states:kind==='daily'?states:rentalStates}})));
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
 function blockState(code='11110',kind='daily'){
  let started,aborted;const gate={started:new Promise(resolve=>started=resolve),aborted:new Promise(resolve=>aborted=resolve)};
  intercepts.set((kind==='daily'?states:rentalStates)[code][month],signal=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted();reject(signal.reason);},{once:true});started();}));
  return gate;
 }
 function rentalWorker(){
  const scope=context(),pending=new Map();let serial=0;
  scope.postMessage=data=>{if(data.progress)return;pending.get(data.id)?.(data);pending.delete(data.id);};
  scope.importScripts=(...urls)=>{for(const url of urls){if(url.split('?')[0]==='/js/regional-data.js')continue;vm.runInContext(readFileSync(new URL('..'+url.split('?')[0],import.meta.url),'utf8'),scope,{filename:url});}};
  vm.runInContext(readFileSync(new URL('../js/rental-worker.js',import.meta.url),'utf8'),scope,{filename:'rental-worker.js'});
  return(action,settings)=>new Promise(resolve=>{const id=++serial;pending.set(id,resolve);scope.onmessage({data:{id,action,settings}});});
 }
 return{client,requests,intercepts,quarters,states,rentalStates,blockState,rentalWorker,reopenDaily:()=>scope.NodoDailyClient.create(),count:path=>requests.filter(p=>p===path).length};
}

test('cancelled packed state is immediately retryable without losing completed quarters or shards',async()=>{
 const f=await fixture(),c=f.client;
 await c.priceFrame(day,{r:2});const completed=await c.month(month,2,true),otherLoads=f.count(f.states['28110'][month]);
 const gate=f.blockState(),old=c.priceFrame(day,{r:1});await gate.started;
 c.cancelPrices();const latest=c.priceFrame(day,{r:1});
 const [stale,current]=await Promise.all([old,latest]);
 assert.equal(stale.values.length,0,'cancelled result cannot update the cursor');
 assert.equal(current.values[0].get('11110:0')[4],100);
 assert.equal(f.count(f.states['11110'][month]),2,'aborted state gets a fresh request');
 assert.equal(f.count(f.quarters['11110'][month]),1,'successful or pending quarter is reused');
 assert.equal(await c.month(month,2,true),completed,'completed unrelated shard survives');
 assert.equal(f.count(f.states['28110'][month]),otherLoads);
 const before=f.requests.length;assert.equal((await c.priceFrame(day,{r:1})).values[0].size,1);assert.equal(f.requests.length,before);
});

test('a rapid province change can return to the cancelled packed month immediately',async()=>{
 const f=await fixture(),c=f.client;await c.priceFrame(day,{r:2});
 const gate=f.blockState(),first=c.priceFrame(day,{r:1});await gate.started;
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
