import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
import {packedAssetSet} from './packed-asset-cache.mjs';
import {packedDataset} from '../js/packed-data.mjs';
import {encodeRecords} from '../js/packed-records.mjs';

test('stable ID buckets reuse bytes across releases and only changed buckets are packed',async()=>{
 const root=mkdtempSync(join(tmpdir(),'packed-assets-'));
 try{
  const entries=Array.from({length:100},(_,i)=>['apt:'+i,{id:'apt:'+i,area:59.975,price:i,null:null}]),aStats={},bStats={},cStats={};
  const a=packedAssetSet(root,'data/search/test',entries,{stats:aStats});assert.equal(aStats.encoded,32);
  assert.equal(a.manifest.format,'gzip-json-records-v1');for(const asset of a.assets){const raw=gunzipSync(asset.bytes);assert.equal(raw.length,a.manifest.rawBytes[asset.path]);assert.equal(typeof JSON.parse(raw),'object');}
  const b=packedAssetSet(root,'data/search/test',[...entries].reverse(),{stats:bStats});assert.deepEqual(a,b);assert.equal(bStats.encoded,0);assert.equal(bStats.reused,32);
  entries[0][1].price=12345;const c=packedAssetSet(root,'data/search/test',entries,{stats:cStats});assert.equal(cStats.encoded,1);assert.equal(cStats.reused,31);
  assert.equal(c.assets.filter(v=>!a.manifest.sources[v.path]).length,1);
  let downloads=0;const assets=new Map(c.assets.map(v=>[v.path,v.bytes])),reader=packedDataset(c.manifest,{cache:{download:async(path,hash)=>{downloads++;assert.equal(c.manifest.sources[path],hash);return assets.get(path);}},decode:async b=>gunzipSync(b)});
  assert.deepEqual(await reader.get('apt:0'),entries[0][1]);assert.equal(downloads,1);await reader.get('apt:0');assert.equal(downloads,1);
  assert.equal(await reader.get('missing'),undefined);
  assert.deepEqual((await reader.all()).sort((a,b)=>a.id.localeCompare(b.id)),entries.map(x=>x[1]).sort((a,b)=>a.id.localeCompare(b.id)));
  assert.throws(()=>packedDataset({...c.manifest,sources:{...c.manifest.sources,'data/search/test/../../private.bin':'a'.repeat(64)}},{cache:{},decode:()=>{}}),/Invalid/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

function browserFixture(){
 const root=mkdtempSync(join(tmpdir(),'packed-search-browser-')),repo=join(import.meta.dirname,'..'),files=new Map(),seen=[],broken=new Set(),stores=new Map();
 const apartment={id:'apt:1',name:'리센츠',aliases:['잠실 리센츠'],r:1,g:'송파구',d:'잠실동',addresses:[],keys:['apt:1','source:1'],saleIds:['source:1'],rentalIds:['source:1'],mapIds:[],rows:[0]},prices=[{id:apartment.id,area:84,type:'jeonse',deposit:50000,date:'2026-09-01',transactionId:'one'}];
 const add=(kind,entries)=>{const prefix='data/search/'+kind,packed=packedAssetSet(root,prefix,entries);for(const a of packed.assets)files.set('/'+a.path,a.bytes);return {schema:1,version:'fixture',inputs:{'data/index.json':'a'.repeat(64)},...packed.manifest};};
 files.set('/data/search/latest-index.json',Buffer.from(JSON.stringify(add('latest',[[apartment.id,{apartment,prices}]]))));files.set('/data/search/apartments.json',Buffer.from(JSON.stringify(add('catalog',[[apartment.id,apartment]]))));
 const caches={open:async name=>{if(!stores.has(name)){const entries=new Map();stores.set(name,{match:async key=>entries.get(key)?.clone(),put:async(key,value)=>{entries.delete(key);entries.set(key,value.clone());},keys:async()=>[...entries.keys()],delete:async key=>entries.delete(key)});}return stores.get(name);}};
 const create=worker=>{
  const context=vm.createContext({console,Response,Blob,DecompressionStream,TransformStream,AbortController,TextDecoder,TextEncoder,crypto:webcrypto,performance,caches,fetch:async url=>{const path=String(url).split('?')[0];seen.push(path);return new Response(broken.has(path)?'corrupt':files.get(path)||'',{status:files.has(path)?200:404});}});context.self=context;
  if(!worker)vm.runInContext(readFileSync(join(repo,'js/verified-data-cache.js'),'utf8'),context);
  const path=join(repo,worker?'js/apartment-search-worker.js':'js/home-search-data.js'),bundle=buildSync({entryPoints:[path],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022'}).outputFiles[0].text;
  const pending=new Map();let serial=0;context.postMessage=message=>{pending.get(message.id)?.(message);pending.delete(message.id);};vm.runInContext(bundle,context);
  return {load:()=>context.NodoHomeSearchData.load(),request:(action,values={})=>new Promise(resolve=>{const id=++serial;pending.set(id,resolve);context.onmessage({data:{id,action,version:'release',...values}});})};
 };
 return {apartment,prices,seen,broken,files,create,close:()=>rmSync(root,{recursive:true,force:true})};
}

test('packed home loader shares all 32 buckets, retains values and reuses verified bytes after reload',async()=>{
 const f=browserFixture();try{
  const home=f.create(false),all=await Promise.all(Array.from({length:10},()=>home.load()));assert.ok(all.every(x=>x===all[0]));assert.deepEqual(JSON.parse(JSON.stringify(all[0].apartments)),[f.apartment]);assert.deepEqual(JSON.parse(JSON.stringify(all[0].prices)),f.prices);
  assert.equal(f.seen.filter(p=>p.endsWith('.bin')).length,32);assert.equal(f.seen.filter(p=>p.endsWith('latest-index.json')).length,1);
  const before=f.seen.length;await f.create(false).load();assert.deepEqual(f.seen.slice(before),['/data/search/latest-index.json'],'reload reuses every content-addressed bucket from Cache Storage');
 }finally{f.close();}
});

test('packed autocomplete bundle shares preparation, resolves aliases and retries a failed bucket',async()=>{
 const f=browserFixture();try{
  const worker=f.create(true),[searched,found]=await Promise.all([worker.request('search',{query:'ㄹㅅㅊ'}),worker.request('lookup',{key:'source:1'})]);assert.equal(searched.error,undefined);assert.equal(searched.result[0].id,f.apartment.id);assert.equal(found.result.id,f.apartment.id);assert.equal(f.seen.filter(p=>p.endsWith('.bin')).length,32);
 }finally{f.close();}
 const f2=browserFixture();try{
  const path=[...f2.files.keys()].find(p=>p.includes('/catalog/')&&p.endsWith('.bin'));f2.broken.add(path);const worker=f2.create(true);assert.ok((await worker.request('lookup',{key:'source:1'})).error);f2.broken.clear();assert.equal((await worker.request('lookup',{key:'source:1'})).result.id,f2.apartment.id);
 }finally{f2.close();}
});

test('JSON bucket objects share pending reads, retry failures and evict by source bytes and count',async()=>{
 const root=mkdtempSync(join(tmpdir(),'packed-buffer-'));try{
  const keys=new Map();for(let n=0;keys.size<8;n++){const key='apt:'+n,bucket=createHash('sha256').update(key).digest()[0]%8;if(!keys.has(bucket))keys.set(bucket,key);}
  const entries=[...keys.values()].map(id=>[id,{id,text:'내용'.repeat(1000)}]),packed=packedAssetSet(root,'data/search/test',entries,{buckets:8}),assets=new Map(packed.assets.map(a=>[a.path,a.bytes])),sizes=packed.assets.map(a=>gunzipSync(a.bytes).length),ids=entries.map(([id])=>id);
  let downloads=0,release,blocked=false,failed=false;const cache={download:async path=>{downloads++;if(blocked)await new Promise(r=>release=r);if(failed)throw Error('network failed');return assets.get(path);}},decode=async bytes=>gunzipSync(bytes);
  const reader=packedDataset(packed.manifest,{cache,decode});blocked=true;
  const one=reader.get(ids[0]),two=reader.get(ids[0]);while(!release)await new Promise(r=>setImmediate(r));blocked=false;release();assert.deepEqual(await one,await two);assert.equal(downloads,1);
  for(const id of ids.slice(1,5))await reader.get(id);await reader.get(ids[0]);assert.equal(downloads,6,'fifth bucket evicts the least recently used of four');
  const limited=packedDataset(packed.manifest,{cache,decode,maxBytes:Math.max(...sizes)});downloads=0;
  await limited.get(ids[0]);await limited.get(ids[1]);await limited.get(ids[0]);assert.equal(downloads,3,'two retained buffers exceed the byte budget');
  const oversized=packedDataset(packed.manifest,{cache,decode,maxBytes:Math.min(...sizes)-1});downloads=0;
  await oversized.get(ids[0]);await oversized.get(ids[0]);assert.equal(downloads,2,'a single oversized buffer is not retained');
  const retry=packedDataset(packed.manifest,{cache,decode});failed=true;await assert.rejects(retry.get(ids[0]),/network failed/);failed=false;assert.deepEqual(await retry.get(ids[0]),entries[0][1]);
  for(const options of [{maxFiles:-1},{maxBytes:Infinity}])assert.throws(()=>packedDataset(packed.manifest,{cache,decode,...options}),/Invalid/);
  await assert.rejects(reader.get(1),/Invalid packed record key/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('JSON records validate actual inflated bytes and retry without retaining malformed objects',async()=>{
 const root=mkdtempSync(join(tmpdir(),'json-records-'));try{
  const entries=[['__proto__',{name:'한글 값'}],['a',{value:42}]],packed=packedAssetSet(root,'data/search/test',entries,{buckets:1}),asset=packed.assets[0],path=asset.path;
  const cache={download:async()=>asset.bytes},options={cache};
  const reader=packedDataset(packed.manifest,options);assert.deepEqual(await reader.get('__proto__'),entries[0][1]);assert.equal(await reader.get('constructor'),undefined);
  for(const rawBytes of [undefined,{},{[path]:NaN},{[path]:-1},{[path]:packed.manifest.rawBytes[path],extra:2}])assert.throws(()=>packedDataset({...packed.manifest,rawBytes},options),/byte length/);
  for(const delta of [-1,1]){
   const malformed=packedDataset({...packed.manifest,rawBytes:{[path]:packed.manifest.rawBytes[path]+delta}},options);
   await assert.rejects(malformed.get('a'),/byte length/);await assert.rejects(malformed.get('a'),/byte length/);
  }
  for(const value of ['[]','null','17']){
   const raw=Buffer.from(value),bad=packedDataset({...packed.manifest,rawBytes:{[path]:raw.length}},{cache:{download:async()=>gzipSync(raw)}});
   await assert.rejects(bad.all(),/Invalid JSON records/);
  }
  let broken=true;const retried=packedDataset(packed.manifest,{cache:{download:async()=>broken?gzipSync('!'.repeat(packed.manifest.rawBytes[path])):asset.bytes}});
  await assert.rejects(retried.get('a'),SyntaxError);broken=false;assert.deepEqual(await retried.get('a'),entries[1][1]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('generic packed-records-v1 datasets remain readable after the JSON search transition',async()=>{
 const entries=[['a',{name:'기존 BIN',area:59.975}],['b',{nullable:null}]],bytes=gzipSync(encodeRecords(entries)),sha=createHash('sha256').update(bytes).digest('hex'),prefix='data/search/legacy',path=prefix+'/00-'+sha+'.bin';
 const reader=packedDataset({format:'packed-records-v1',buckets:1,prefix,sources:{[path]:sha}},{cache:{download:async()=>bytes},decode:async input=>gunzipSync(input)});
 assert.deepEqual(await reader.get('a'),entries[0][1]);assert.deepEqual(await reader.all(),entries.map(x=>x[1]));
});
