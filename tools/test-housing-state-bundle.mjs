import test from 'node:test';import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';import {createHash,webcrypto} from 'node:crypto';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import '../js/regional-data.js';
import {encodeStateBundle,stateBundle,statePayload} from '../js/housing-state-bundle.mjs';
import {bundleStateYear} from './housing-state-bundles.mjs';
import {packedReader,createHousingDecodeCache} from './housing-regional-reader.mjs';
import {create} from '../js/housing-regional.mjs';import {validateManifest} from '../js/housing-validation.mjs';
import {packQuarter,encodeQuarter} from '../js/housing-quarter.mjs';import {packStateTimeline,encodeStateFile} from '../js/housing-state-timeline.mjs';import * as codec from '../js/generated/housing-columns.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const part=s=>{const bytes=gzipSync(s);return {bytes,sha256:hash(bytes)};};
const sample=()=>encodeStateBundle('11680','2026',{daily:part('sale'),rental:part('rental')});
test('annual container preserves original streams and rejects truncation, extra bytes and wrong scope',async()=>{
 const parts={daily:part('sale'),rental:part('rental')},bytes=encodeStateBundle('11680','2026',parts),bundle=stateBundle(bytes,{lawd:'11680',year:'2026'});
 for(const kind of ['daily','rental']){assert.deepEqual(Buffer.from(bundle.part(kind)),parts[kind].bytes);assert.equal(new TextDecoder().decode(await statePayload(bytes,kind,'11680')),kind==='daily'?'sale':'rental');}
 assert.throws(()=>stateBundle(bytes,{lawd:'11110'}));assert.throws(()=>stateBundle(bytes,{lawd:'11680',year:'2025'}));
 assert.throws(()=>stateBundle(bytes.slice(0,-1)));assert.throws(()=>stateBundle(new Uint8Array([...bytes,0])));
 const broken=bytes.slice();broken[bundle.sections.daily.offset]=0;assert.throws(()=>stateBundle(broken));
 assert.throws(()=>stateBundle(encodeStateBundle('11680','2026',{daily:parts.daily})).part('rental'));
});
test('packing retains oversize and established partitions; empty kinds have no section',()=>{
 const source=part('sale'),p='data/daily/regions/11680/states/daily/2026.bin',paths={daily:p,rental:null},sources={[p]:source.sha256},emitted=[],retired=[];
 const run=(paths,opts)=>bundleStateYear('11680','2026',paths,sources,()=>source.bytes,(p,b)=>emitted.push([p,b]),p=>retired.push(p),opts);
 assert.equal(run(paths,{maxBytes:source.bytes.length}),null);assert.equal(run({...paths,daily:p.replace('.bin','.parts.json')}),null);assert.equal(run({daily:null,rental:null}),null);assert.equal(emitted.length,0);assert.equal(retired.length,0);
 const value=run(paths);assert.equal(value.oldFiles,1);assert.deepEqual(Object.keys(value.sections),['daily']);assert.deepEqual(retired,[p]);assert.equal(emitted.length,1);
});
test('range downloads verify 206 and full 200, isolate cache entries and reject corrupt responses',async()=>{
 const bytes=sample(),bundle=stateBundle(bytes),expected=hash(bytes),saved=new Map(),calls=[];let mode='range';
 const context=vm.createContext({Response,Blob,TextDecoder,Uint8Array,DecompressionStream,AbortController,crypto:webcrypto,caches:{open:async()=>({match:async p=>saved.get(p)?.clone(),put:async(p,r)=>saved.set(p,r),delete:async p=>saved.delete(p),keys:async()=>[...saved.keys()]})},fetch:async(url,options)=>{
  calls.push([url,options]);const [,start,end]=options.headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number);let body=bytes.slice(start,end+1);
  if(mode==='full')return new Response(bytes);if(mode==='bad-full')return new Response(body);
  if(mode==='corrupt')body[body.length-1]^=1;
  return new Response(body,{status:206,headers:{'Content-Range':`bytes ${mode==='wrong'?start+1:start}-${end}/${bytes.length}`}});
 }});vm.runInContext(readFileSync(new URL('../js/verified-data-cache.js',import.meta.url),'utf8'),context);const cache=context.NodoVerifiedDataCache.create('test'),path='data/daily/regions/11680/states/2026.bin';
 for(const kind of ['daily','rental'])assert.deepEqual(Buffer.from(await cache.download(path,expected,{range:bundle.sections[kind]})),Buffer.from(bundle.part(kind)));
 assert.equal(calls.length,2);assert.notEqual(calls[0][0],calls[1][0]);await cache.download(path,expected,{range:bundle.sections.daily});assert.equal(calls.length,2);
 mode='full';assert.deepEqual(Buffer.from(await cache.download(path,expected,{range:bundle.sections.daily,persist:false})),Buffer.from(bundle.part('daily')));
 for(mode of ['bad-full','wrong','corrupt'])await assert.rejects(cache.download(path,expected,{range:bundle.sections.daily,persist:false}));
 assert.deepEqual(Buffer.from(await context.NodoVerifiedDataCache.decode(bytes,path)),Buffer.from(bytes));
 assert.equal(await context.NodoVerifiedDataCache.decode(gzipSync(JSON.stringify('sale')),path),'sale');
});
test('Node and browser share year files without mixing kinds, including backward years and selected regions',async()=>{
 const code='11110',identity={complexes:['source'],areas:[[0,'59.1']]},prefix='data/daily/regions/'+code,files={},sources={},quarters={},states={daily:{},rental:{}},sections={daily:{},rental:{}},expected={};
 const emit=(p,v)=>{files[p]=v;sources[p]=hash(v instanceof Uint8Array?v:JSON.stringify(v));};
 emit(prefix+'/identities.json',identity);emit(prefix+'/metadata.json',{complexes:[{id:'source',n:'단지',r:1}],areas:[]});emit('data/daily/regions/index.json',{schema:3,regions:{[code]:{identities:prefix+'/identities.json',metadata:prefix+'/metadata.json'}}});
 for(const year of ['2025','2026']){const opening={daily:{},rental:{}};
  for(const month of ['01','12']){const ym=year+'-'+month,date=Number(year+month+'01'),sale=[code+':0',date,100,120,110,2],rent=[code+':0','59.1',date,100,2,0,null,0,null,null,null,null,101,0,null,null,'02'.repeat(10)];rent.splice(12,0,null);
   const data={daily:{rows:[],updates:[],opening:[sale]},rental:{rows:[],updates:[],opening:[rent]}};expected[ym]=data;for(const kind of ['daily','rental'])opening[kind][ym]=data[kind].opening;
   const q=year+'-Q'+Math.ceil(Number(month)/3),p=prefix+'/quarters/'+q+'.bin';emit(p,encodeQuarter(packQuarter(code,q,{[ym]:data},identity,codec)));quarters[ym]=p;
  }
  const parts={};for(const kind of ['daily','rental']){const bytes=gzipSync(encodeStateFile(packStateTimeline(code,kind,opening[kind],codec)));parts[kind]={bytes,sha256:hash(bytes)};}
  const p=prefix+'/states/'+year+'.bin',bytes=encodeStateBundle(code,year,parts);emit(p,bytes);for(const kind of ['daily','rental']){sections[kind][p]=stateBundle(bytes).sections[kind];for(const month of ['01','12'])states[kind][year+'-'+month]=p;}
 }
 const decodeCache=createHousingDecodeCache();
 for(const kind of ['daily','rental']){const manifest={schema:3,months:Object.keys(expected),sources,regional:{format:'packed-region',kind,authority:'data/daily/regions/index.json',quarters:{[code]:quarters},states:{[code]:states[kind]},stateSections:sections[kind]}};
  const node=packedReader(kind,manifest,p=>files[p],{decodeCache});
  for(const partial of [false,true]){const browser=await create(manifest,kind,async p=>partial&&sections[kind][p]?new Uint8Array(gunzipSync(stateBundle(files[p]).part(kind))):files[p],{codes:[code]});
   for(const ym of ['2026-12','2025-01','2026-01','2025-12']){assert.deepEqual(node.regionMonth(code,ym),expected[ym][kind]);assert.deepEqual(await browser.regionMonth(code,ym),expected[ym][kind]);}
  }
  const bad=structuredClone(manifest);delete bad.regional.stateSections[states[kind]['2025-01']];assert.throws(()=>validateManifest(bad,node.table),/Missing state section/);
 }
 assert.ok(decodeCache.stats.hits>0);
});
