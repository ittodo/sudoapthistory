import {privateCache} from './private-cache.mjs';
import {codeDependencyEngine} from './code-dependencies.mjs';
import '../js/rental-model.js';
import '../js/market-rental-model.js';
import {regionalReader} from './regional-reader.mjs';
import {createHousingDecodeCache} from './housing-regional-reader.mjs';
import {readFileSync,writeFileSync,existsSync,mkdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
const hash=b=>createHash('sha256').update(b).digest('hex');
const prefix='data/rental/market-cache/';
export function compactMarketShard(shard){return {schema:1,rows:shard.rows.filter(r=>!r[7]).map(r=>[r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[16],r[15],r[17]])};}
export function rentalMarketAssets(root,options={}){
  const source=join(root,'data/rental/index.json');if(!existsSync(source))return [];
  const reader=regionalReader(root,'rental',{verifyOnce:true,decodeCache:createHousingDecodeCache()}),manifest=reader.manifest,assets=[],sources={},inputs={},directory=join(root,'cloudflare/dist/rental-market-cache-v1');
 if(manifest.schema===3)return summaryAssets(root,reader,options);
 const codeHash=hash(Buffer.concat([readFileSync(join(root,'tools/build-rental-market-cache.mjs')),readFileSync(join(root,'tools/regional-data.mjs')),readFileSync(join(root,'js/regional-data.js'))]));
  for(const p of [join(root,'cloudflare'),join(root,'cloudflare/dist'),directory])if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('Symlink market cache output');
  mkdirSync(directory,{recursive:true});
  for(const month of manifest.months){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Invalid market month');for(const region of ['11','41','28']){
    const input=`data/rental/months/${month}-${region}.bin`,expected=manifest.schema===2?reader.fingerprint(input):manifest.sources[input];if(!expected)continue;
    const raw=manifest.schema===1?readFileSync(join(root,input)):null;if(raw&&hash(raw)!==expected)throw Error('Market input hash mismatch: '+input);if(raw)inputs[input]=expected;
    const name=`${month}-${region}.bin`,target=join(directory,name),stamp=target+'.json';let saved,bytes;try{saved=JSON.parse(readFileSync(stamp));}catch{}
    const fingerprint=hash(JSON.stringify([codeHash,expected]));
    if(saved?.inputHash===fingerprint&&existsSync(target)){const b=readFileSync(target);if(hash(b)===saved.hash)bytes=b;}
    if(!bytes){bytes=gzipSync(JSON.stringify(compactMarketShard(reader.read(input))),{level:6});writeFileSync(target,bytes);writeFileSync(stamp,JSON.stringify({inputHash:fingerprint,hash:hash(bytes)}));}
    if(bytes.length>25*1024*1024)throw Error('Market asset exceeds 25 MiB');const path=prefix+name;sources[path]=hash(bytes);assets.push({path,source:target,sha256:sources[path],size:bytes.length});
  }}
  const sale=join(root,'data/market.json');const saleStartYear=existsSync(sale)?JSON.parse(readFileSync(sale)).meta.startYear:2006;
  for(const p of ['data/rental/catalog.bin','data/rental/rates.json'])if(manifest.sources[p])inputs[p]=manifest.sources[p];
  Object.assign(inputs,reader.inputs);assets.push({path:prefix+'index.json',bytes:Buffer.from(JSON.stringify({schema:1,sourceVersion:manifest.version,months:manifest.months,saleStartYear,inputs,sources}))});return assets;
}

// Market charts need statistics, not the common transaction-detail quarters.
// Cache each month independently; only changed months are decoded again.
function summaryAssets(root,reader,{months=reader.manifest.months,stats={}}={}){
 const M=globalThis.NodoMarketRental,R=globalThis.NodoRental,m=reader.manifest,assets=[],sources={},inputs={},years={},directory=join(root,'cloudflare/dist/rental-market-summary-v2');
 const cache=privateCache(root,'cloudflare/dist/rental-market-summary-v2');
 try {
 const codeHash=codeDependencyEngine(root,{roots:['tools/build-rental-market-cache.mjs']});
 for(const p of [join(root,'cloudflare'),join(root,'cloudflare/dist'),directory])if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('Symlink market cache output');mkdirSync(directory,{recursive:true});
 const catalog=reader.catalog.complexes;R.normalizeDistricts(catalog);
 const districts=Object.fromEntries(['11','41','28'].map(r=>[r,[...new Set(catalog.filter(c=>M.codes[c.r]===r).map(c=>c.g))].sort((a,b)=>a.localeCompare(b,'ko'))]));
 const districtRegions=Object.fromEntries(catalog.map(c=>[c.g,M.codes[c.r]]));Object.assign(stats,{reused:0,calculated:0,decoded:0,semanticReused:0});
 // Summaries use normalized district/province bindings, not names, coordinates
 // or household counts. Keep the compound row key bound to its grouping fields.
 const groupingHash=hash(JSON.stringify(catalog.map(c=>[c.key,c.r,c.g])));
 // Identity files are append-only. Bind the exact old prefix, not unrelated new
 // sale areas. Changed prefixes still decode; physical hashes remain in inputs.
 const identityMemo=new Map();
 function identityProof(counts){return [...reader.table.regions].map(([code,r])=>{
  const lengths=counts?.[code]??[r.identity.complexes.length,r.identity.areas.length],key=code+':'+lengths.join(':');
  if(!identityMemo.has(key))identityMemo.set(key,hash(JSON.stringify([r.identity.complexes.slice(0,lengths[0]),r.identity.areas.slice(0,lengths[1])])));
  return [code,lengths,identityMemo.get(key)];
 });}
 const counts=Object.fromEntries([...reader.table.regions].map(([code,r])=>[code,[r.identity.complexes.length,r.identity.areas.length]]));
 for(const month of months){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!m.months.includes(month))throw Error('Invalid market month');
  const dependencies=['11','41','28'].map(r=>{
   const path=`data/rental/months/${month}-${r}.bin`;reader.fingerprint(path);
   return reader.dependencies(path).filter(p=>!p.endsWith('/identities.json')).map(p=>[p,m.sources[p]]);
  });
  const target=join(directory,month+'.bin'),stamp=target+'.json';let saved,cached,bytes;
  try{saved=JSON.parse(cache.read(stamp));if(process.env.NODO_FULL_VERIFY!=='1'&&saved.schema===3&&saved.codeHash===codeHash&&cache.exists(target)){const b=cache.read(target);if(hash(b)===saved.hash)cached=b;}}catch{}
  const proof=lengths=>hash(JSON.stringify([groupingHash,dependencies,identityProof(lengths)]));
  if(cached&&saved.inputHash===proof(saved.counts)){bytes=cached;stats.reused++;}else{
   const rows=[];for(const r of ['11','41','28'])for(const row of compactMarketShard(reader.read(`data/rental/months/${month}-${r}.bin`)).rows)rows.push(row);
   stats.decoded++;
   // Preserve order and duplicate multiplicity. These are exactly the fields
   // summarize consumes; date, source labels and sale-only changes are irrelevant.
   const semanticHash=hash(JSON.stringify(rows.map(r=>{const c=catalog[r[0]];if(!c)throw Error('Unknown market complex');return [r[1],r[3],r[4],r[5],r[7],c.r,c.g];})));
   if(cached&&saved.semanticHash===semanticHash){bytes=cached;stats.reused++;stats.semanticReused++;}
   else{bytes=gzipSync(JSON.stringify({schema:2,month,groups:M.summarize(rows,catalog)}),{level:6});cache.write(target,bytes);stats.calculated++;}
   cache.write(stamp,JSON.stringify({schema:3,codeHash,inputHash:proof(counts),counts,semanticHash,hash:hash(bytes)}));
  }
  const value=JSON.parse(gunzipSync(bytes));value.groups.districtRegions=districtRegions;
  (years[month.slice(0,4)]??={})[month]=value;
 }
 // Bind every metadata/identity/quarter dependency, even on a reused month.
 Object.assign(inputs,reader.inputs);for(const[p,h]of Object.entries(inputs))reader.physical(p,false);reader.recheck();
 for(const[year,data]of Object.entries(years)){const bytes=gzipSync(JSON.stringify({schema:2,months:data}),{level:6}),path=prefix+year+'-summary.bin';if(bytes.length>25*1024*1024)throw Error('Market summary exceeds 25 MiB');sources[path]=hash(bytes);assets.push({path,bytes});}
 const sale=join(root,'data/market.json'),saleStartYear=existsSync(sale)?JSON.parse(readFileSync(sale)).meta.startYear:2006;
 assets.push({path:prefix+'index.json',bytes:Buffer.from(JSON.stringify({schema:2,sourceVersion:m.version,months,saleStartYear,districts,inputs,sources}))});stats.bytes=assets.reduce((n,a)=>n+a.bytes.length,0);return assets;
 } finally { cache.close(); }
}
