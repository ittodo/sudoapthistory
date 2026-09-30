// Invoked only by the official Rust generator, using its verified regional scratch outputs.
import{readFileSync}from'node:fs';import{join,resolve}from'node:path';import{gunzipSync}from'node:zlib';import{createHash}from'node:crypto';
import{buildHousingSales}from'./build-housing-sales.mjs';import{buildHousingDetails}from'./build-housing-details.mjs';import{buildHousingRegions}from'./build-housing-regions.mjs';import*as codec from'../js/generated/housing-columns.mjs';import'../js/regional-data.js';
const hash=b=>createHash('sha256').update(b).digest('hex'),spec=JSON.parse(readFileSync(process.argv[2])),site=resolve(spec.site),checks=new Map();
function json(path,expected){const bytes=readFileSync(path);if(expected&&hash(bytes)!==expected)throw Error('Generated regional hash mismatch: '+path);checks.set(path,hash(bytes));return JSON.parse(path.endsWith('.bin')?gunzipSync(bytes):bytes);}
const descriptor=json(join(site,'data/daily/regions/index.json')),payloads={};for(const path of Object.values(descriptor.regions).flatMap(r=>[r.identities,r.metadata]))payloads[path]=json(join(site,path));
const table=globalThis.NodoRegional.tables(descriptor,payloads,'daily'),readers={};
for(const kind of ['daily','rental']){
 const manifest=json(join(site,`data/${kind}/index.json`)),regional={bases:{}},manifests={};
 for(const[code,scratch]of Object.entries(spec.generated)){const m=json(join(scratch,`data/${kind}/index.json`));manifests[code]=m;regional.bases[code]=Object.fromEntries(m.months.map(month=>[month,true]));}
 readers[kind]={manifest:{...manifest,schema:2,regional},table,inputs:{},regionMonth(code,month){const scratch=spec.generated[code],m=manifests[code],province=code.startsWith('41')?0:code.startsWith('11')?1:2;
  const rowPath=kind==='daily'?`data/daily/${province}/${month}.bin`:`data/rental/months/${month}-${code.slice(0,2)}.bin`,statePath=rowPath.replace('.bin','-state.bin');
  const rows=m.sources[rowPath]?json(join(scratch,rowPath),m.sources[rowPath]).rows:[],state=m.sources[statePath]?json(join(scratch,statePath),m.sources[statePath]):{opening:[],updates:[]};return {rows,...state};
 }};
}
readers.verify=()=>{for(const[path,digest]of checks)if(hash(readFileSync(path))!==digest)throw Error('Generated input changed during packing');};
const result=buildHousingRegions(site,resolve(spec.output),codec,{readers,previousRoot:spec.previous,cacheDir:spec.cache});const sales=buildHousingSales(site,resolve(spec.output),spec.excludedSales||[]);const details=buildHousingDetails(site,resolve(spec.output));console.log(JSON.stringify({status:result.status,sales,details,regions:result.metrics.length,rows:result.metrics.reduce((n,r)=>n+r.rows,0),bytes:result.metrics.reduce((n,r)=>n+r.bytes,0)}));
