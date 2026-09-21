import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,webcrypto} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import vm from 'node:vm';
import {compactMapShard,rentalMapAssets} from './build-rental-map-cache.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const row=(ci,area,date,rent,id,contract=0)=>[ci,String(area),date,10000,rent,contract,3,0,20170101,10,20,10,20,rent?150:10000,8,'2017-01',6,id];
const shard={opening:[row(0,59,20170101,0,'b'),row(0,84,20170101,0,'a'),row(0,59,20170101,100,'c'),row(1,59,20170101,0,'d')],updates:[row(0,59,20170203,0,'x'),row(0,84,20170203,0,'z'),row(0,59,20170204,120,'q',1)]};
const catalog=[{id:'a',publicId:'a',n:'단지',g:'구',d:'동',r:1,coord:[37.5,127],admin:['dong']},{id:'b',n:'미위치',g:'구',d:'동',r:1,coord:null,admin:[]}];
function worker(extras={}){
 const c=vm.createContext({console,Response,Blob,TextDecoder,DecompressionStream,AbortController,crypto:webcrypto,...extras});c.self=c;
 c.importScripts=(...urls)=>urls.forEach(url=>vm.runInContext(readFileSync(new URL('..'+url.split('?')[0],import.meta.url),'utf8'),c));
 vm.runInContext(readFileSync(new URL('../js/rental-worker.js',import.meta.url),'utf8'),c);c.fixtureCatalog=catalog;vm.runInContext('catalog=fixtureCatalog',c);return c;
}
const plain=x=>JSON.parse(JSON.stringify(x));
test('compact cache preserves dates, ties, filters, reverse playback and type switches',()=>{
 const c=worker();c.original=shard;c.compact={jeonse:compactMapShard(shard,'jeonse'),monthly:compactMapShard(shard,'monthly')};
 for(const type of ['jeonse','monthly','jeonse'])for(const day of ['2017-02-01','2017-02-03','2017-02-05','2017-02-02'])for(const filter of [{},{contract:'1'},{areaMin:60},{kind:'up'},{bounds:{south:33,north:34,west:126,east:128}},{convert:false}]){
  c.selection={type,day,convert:true,compactMap:true,contract:'all',kind:'all',...filter};
  const old=vm.runInContext("mapView([original],['11'],selection)",c);
  const next=vm.runInContext("mapView([compact[selection.type]],['11'],selection)",c);
  assert.deepEqual(plain(next),plain(old),JSON.stringify(c.selection));
 }
});
test('packaging cache is deterministic, repairs corruption and rejects changed inputs',()=>{
 const root=mkdtempSync(join(tmpdir(),'rental-map-cache-'));
 try{
  mkdirSync(join(root,'data/rental/months'),{recursive:true});const sources={};
  for(const region of ['11','41','28']){const p=`data/rental/months/2017-02-${region}-state.bin`,b=gzipSync(JSON.stringify(shard));sources[p]=hash(b);writeFileSync(join(root,p),b);}
  writeFileSync(join(root,'data/rental/index.json'),JSON.stringify({version:'v1',months:['2017-02'],sources}));
  const first=rentalMapAssets(root),second=rentalMapAssets(root);assert.equal(first.length,7);assert.deepEqual(first,second);
  writeFileSync(first[0].source,'bad cache');assert.deepEqual(rentalMapAssets(root),first);
  writeFileSync(join(root,Object.keys(sources)[0]),'bad source');assert.throws(()=>rentalMapAssets(root),/input changed/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('verified browser cache survives workers, repairs damage and tolerates unavailable storage',async()=>{
 const path='data/rental/map-cache/2017-02-11-jeonse.bin',bytes=gzipSync(JSON.stringify(compactMapShard(shard,'jeonse'))),expected=hash(bytes);
 const stored=new Map(),store={match:async k=>stored.get(k)?.clone(),put:async(k,v)=>stored.set(k,v.clone()),keys:async()=>[...stored.keys()],delete:async k=>stored.delete(k)};
 let downloads=0;
 function client(storage={open:async()=>store}){const c=worker({caches:storage,fetch:async()=>{downloads++;return new Response(bytes);}});c.path=path;c.expected=expected;vm.runInContext('manifest={sources:{}};mapCache={sources:{[path]:expected}}',c);return c;}
 await vm.runInContext('load(path)',client());assert.equal(downloads,1);
 await vm.runInContext('load(path)',client());assert.equal(downloads,1,'new worker reuses verified disk bytes');
 stored.set('/'+path+'?v='+expected,new Response('damaged'));
 await vm.runInContext('load(path)',client());assert.equal(downloads,2,'corrupt cached bytes are replaced');
 await vm.runInContext('load(path)',client({open:async()=>{throw Error('quota');}}));assert.equal(downloads,3,'storage failure still permits ordinary loading');
});
test('compact date and type changes abort obsolete downloads and reject stale manifests',async()=>{
 const month='data/rental/map-cache/2017-02-11-jeonse.bin',later='data/rental/map-cache/2017-03-11-monthly.bin';
 const bytes=gzipSync(JSON.stringify(compactMapShard(shard,'jeonse'))),expected=hash(bytes);
 let started;const begun=new Promise(r=>started=r);
 const c=worker({fetch:async(url,{signal}={})=>{
  if(url.includes('index.json'))return Response.json({schema:1,sourceVersion:'old',inputs:{},sources:{[month]:expected}});
  started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
 }});
 c.month=month;c.later=later;c.expected=expected;
 vm.runInContext("manifest={version:'new',sources:{}}",c);
 await vm.runInContext('ensureMapCache()',c);assert.equal(vm.runInContext('mapCache',c),undefined);
 vm.runInContext("mapCache={sources:{[month]:expected,[later]:expected}};beginView({map:true,day:'2017-02-01',region:'11',type:'jeonse'})",c);
 const loading=vm.runInContext('load(month)',c),rejected=assert.rejects(loading,/aborted/);
 await begun;
 vm.runInContext("beginView({map:true,day:'2017-03-01',region:'11',type:'monthly'})",c);
 await rejected;assert.equal(vm.runInContext('cache.has(month)',c),false);
 assert.equal(vm.runInContext('activeMapPaths.has(later)',c),true);
});
