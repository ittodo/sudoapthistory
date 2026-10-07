import{GenerationFileSession}from'./housing-generation-batch.mjs';
import {performance} from 'node:perf_hooks';
// Invoked only by the official Rust generator, using its verified regional scratch outputs.
import{scopedNativeMonth}from'./housing-native-adapter.mjs';
import{VerifiedNativeInputs}from'./housing-native-inputs.mjs';
import{readFileSync}from'node:fs';import{join,resolve}from'node:path';import{createHash}from'node:crypto';
import{buildHousingSales}from'./build-housing-sales.mjs';import{buildHousingDetails}from'./build-housing-details.mjs';import{buildHousingRegions}from'./build-housing-regions.mjs';import*as codec from'../js/generated/housing-columns.mjs';import'../js/regional-data.js';
const hash=b=>createHash('sha256').update(b).digest('hex'),spec=JSON.parse(readFileSync(process.argv[2])),site=resolve(spec.site),nativeInputs=new VerifiedNativeInputs({maxParsedBytes:spec.reuse_native_inputs!==false?64*1024*1024:0}),nativeManifests={};
const json=(path,expected)=>nativeInputs.json(path,expected);
const descriptor=json(join(site,'data/daily/regions/index.json')),payloads={};for(const path of Object.values(descriptor.regions).flatMap(r=>[r.identities,r.metadata]))payloads[path]=json(join(site,path));
const table=globalThis.NodoRegional.tables(descriptor,payloads,'daily'),readers={};
for(const kind of ['daily','rental']){
 const manifest=json(join(site,`data/${kind}/index.json`)),regional={bases:{}},manifests={};nativeManifests[kind]=manifests;
 for(const[code,scratch]of Object.entries(spec.generated)){const m=json(join(scratch,`data/${kind}/index.json`));manifests[code]=m;regional.bases[code]=Object.fromEntries(m.months.map(month=>[month,true]));}
 readers[kind]={manifest:{...manifest,schema:2,regional},table,inputs:{},regionMonth(code,month){const scratch=spec.generated[code],m=manifests[code],province=code.startsWith('41')?0:code.startsWith('11')?1:2;
  const rowPath=kind==='daily'?`data/daily/${province}/${month}.bin`:`data/rental/months/${month}-${code.slice(0,2)}.bin`,statePath=rowPath.replace('.bin','-state.bin');
  const rows=m.sources[rowPath]?json(join(scratch,rowPath),m.sources[rowPath]).rows:[],state=m.sources[statePath]?json(join(scratch,statePath),m.sources[statePath]):{opening:[],updates:[]};return scopedNativeMonth(code,{rows,...state});
 }};
}
readers.regionFingerprint=code=>hash(JSON.stringify(['daily','rental'].map(kind=>{const m=manifestsFor(kind,code);return [kind,m.months,Object.entries(m.sources).filter(([path,digest])=>{if(path===`data/${kind}/catalog.bin`){nativeInputs.check(join(spec.generated[code],path),digest);return false;}return path.endsWith('.bin');}).sort(([a],[b])=>a.localeCompare(b,'en')).map(([path,digest])=>{if(!generationSession?.old)nativeInputs.check(join(spec.generated[code],path),digest);return [path,digest];})];})));
readers.periodFingerprint=(code,months)=>hash(JSON.stringify(['daily','rental'].map(kind=>{
 const m=manifestsFor(kind,code),province=code.startsWith('41')?0:code.startsWith('11')?1:2;
 return [kind,months.map(month=>{const p=kind==='daily'?`data/daily/${province}/${month}.bin`:`data/rental/months/${month}-${code.slice(0,2)}.bin`;
  return [month,...[p,p.replace('.bin','-state.bin')].map(path=>{const digest=m.sources[path];if(!digest)return[path,null];const file=join(spec.generated[code],path);if(!generationSession?.old)nativeInputs.check(file,digest);return[path,digest];})];})];
})));
readers.stateFingerprint=(code,months)=>hash(JSON.stringify(['daily','rental'].map(kind=>{const m=manifestsFor(kind,code),province=code.startsWith('41')?0:code.startsWith('11')?1:2;return[kind,months.map(month=>{const p=kind==='daily'?'data/daily/'+province+'/'+month+'-state.bin':'data/rental/months/'+month+'-'+code.slice(0,2)+'-state.bin';const digest=m.sources[p];if(digest&&!generationSession?.old)nativeInputs.check(join(spec.generated[code],p),digest);return[month,p,digest||null];})];})));
readers.regionOpening=(kind,code,month)=>{const m=manifestsFor(kind,code),province=code.startsWith('41')?0:code.startsWith('11')?1:2,p=kind==='daily'?'data/daily/'+province+'/'+month+'-state.bin':'data/rental/months/'+month+'-'+code.slice(0,2)+'-state.bin';return m.sources[p]?scopedNativeMonth(code,{rows:[],...json(join(spec.generated[code],p),m.sources[p])}).opening:[];};
if(spec.reuse_quarter_cache!==false&&process.env.NODO_FULL_VERIFY!=='1')readers.quarterFingerprint=readers.periodFingerprint;
function manifestsFor(kind,code){return nativeManifests[kind][code];}
readers.verify=()=>nativeInputs.verify();
const generationSession=spec.fileGenerationBatch==null?null:new GenerationFileSession({site,output:resolve(spec.output),cache:spec.cache,batch:spec.fileGenerationBatch,engine:spec.generationEngine??null});
const timings={},phase=(name,fn)=>{const start=performance.now();const result=fn();timings[name]=(performance.now()-start)/1000;return result;};const result=phase('regionPacking',()=>buildHousingRegions(site,resolve(spec.output),codec,{readers,previousRoot:spec.previous,cacheDir:spec.cache,generationSession}));const sales=phase('saleDetails',()=>buildHousingSales(site,resolve(spec.output),spec.excludedSales||[],{cacheDir:spec.cache,generationSession}));const details=phase('rentalDetails',()=>buildHousingDetails(site,resolve(spec.output),spec.previous,{cacheDir:spec.cache,generationSession}));console.log(JSON.stringify({status:result.status,timings,sales,details,nativeInputs:nativeInputs.metrics,consumption:generationSession?.finish()??{status:'NOT_RUN'},packingReuse:{quarters:result.metrics.reduce((n,r)=>n+(r.quartersReused||0),0),years:result.metrics.reduce((n,r)=>n+(r.yearsReused||0),0),monthsDecoded:result.metrics.reduce((n,r)=>n+(r.monthsDecoded||0),0),regions:result.metrics},regions:result.metrics.length,rows:result.metrics.reduce((n,r)=>n+r.rows,0),bytes:result.metrics.reduce((n,r)=>n+r.bytes,0)}));
