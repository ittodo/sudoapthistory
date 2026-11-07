import {privateCache} from './private-cache.mjs';
import {codeDependencyEngine} from './code-dependencies.mjs';
import {encodeRecords,FORMAT} from '../js/packed-records.mjs';
import '../js/rental-model.js';
import '../js/market-rental-model.js';
import {regionalReader} from './regional-reader.mjs';
import {createHousingDecodeCache} from './housing-regional-reader.mjs';
import {partitionDependencies} from '../js/housing-partition.mjs';
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
 // Hash the builder directly so transport imports do not enter calculation dependencies.
 const codeHash=hash(JSON.stringify([hash(readFileSync(join(root,'tools/build-rental-market-cache.mjs'))),codeDependencyEngine(root,{roots:['tools/private-cache.mjs','tools/regional-reader.mjs','tools/housing-regional-reader.mjs','js/rental-model.js','js/market-rental-model.js']})]));
 const packingHash=codeDependencyEngine(root,{roots:['js/packed-records.mjs']});
 for(const p of [join(root,'cloudflare'),join(root,'cloudflare/dist'),directory])if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('Symlink market cache output');mkdirSync(directory,{recursive:true});
 const catalog=reader.catalog.complexes;R.normalizeDistricts(catalog);
 const districts=Object.fromEntries(['11','41','28'].map(r=>[r,[...new Set(catalog.filter(c=>M.codes[c.r]===r).map(c=>c.g))].sort((a,b)=>a.localeCompare(b,'ko'))]));
 const districtRegions=Object.fromEntries(catalog.map(c=>[c.g,M.codes[c.r]]));Object.assign(stats,{reused:0,calculated:0,decoded:0,semanticReused:0,reusedYears:0,packedYears:0});
 // Bind only the stable complex keys used by this month's compacted rows.
 // Catalog order, unrelated complexes and display fields do not affect groups.
 function groupingProof(keys){
  if(!Array.isArray(keys))return null;
  const bindings=[];let previous;
  for(const key of keys){if(typeof key!=='string'||previous!==undefined&&key<=previous)return null;const c=catalog[key];if(!c||c.key!==key)return null;bindings.push([key,c.r,c.g]);previous=key;}
  return hash(JSON.stringify(bindings));
 }
 // Identity files are append-only. Bind the exact old prefix, not unrelated new
 // sale areas. Changed prefixes still decode; physical hashes remain in inputs.
 const identityMemo=new Map();
 function identityProof(regions,counts){
  if(!counts||Array.isArray(counts)||typeof counts!=='object'||Object.keys(counts).sort().join('|')!==regions.join('|'))return null;
  const proof=[];
  for(const code of regions){const r=reader.table.regions.get(code),lengths=counts[code],current=[r.identity.complexes.length,r.identity.areas.length];
   if(!Array.isArray(lengths)||lengths.length!==2||lengths.some((n,i)=>!Number.isSafeInteger(n)||n<0||n>current[i]))return null;
   const key=code+':'+lengths.join(':');
   if(!identityMemo.has(key))identityMemo.set(key,hash(JSON.stringify([r.identity.complexes.slice(0,lengths[0]),r.identity.areas.slice(0,lengths[1])])));
   proof.push([code,lengths,identityMemo.get(key)]);
  }
  return proof;
 }
 for(const month of months){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!m.months.includes(month))throw Error('Invalid market month');
  const provinces=[1,0,2],quarterRegions=[...reader.table.regions].filter(([code,r])=>m.regional.quarters?.[code]?.[month]&&r.metadata.complexes.some(c=>provinces.includes(c.r)));
  const paths=quarterRegions.flatMap(([code])=>partitionDependencies(m.regional.quarters[code][month],m.sources));
  const dependencies=[...new Set(paths)].sort().map(path=>[path,m.sources[path]]);Object.assign(inputs,Object.fromEntries(dependencies));
  // Keep the complete saved prefix for every quarter dependency, including an
  // empty rental quarter. A catalog-only region is not a monthly row input.
  const regions=quarterRegions.map(([code])=>code).sort();
  const counts=Object.fromEntries(regions.map(code=>{const r=reader.table.regions.get(code);return [code,[r.identity.complexes.length,r.identity.areas.length]];}));
  const target=join(directory,month+'.bin'),stamp=target+'.json';let saved,cached,bytes;
  try{saved=JSON.parse(cache.read(stamp));if(process.env.NODO_FULL_VERIFY!=='1'&&saved.schema===4&&saved.codeHash===codeHash&&cache.exists(target)){const b=cache.read(target);if(hash(b)===saved.hash)cached=b;}}catch{}
  const proof=(keys,lengths)=>{const grouping=groupingProof(keys),identities=identityProof(regions,lengths);return grouping&&identities?hash(JSON.stringify([grouping,dependencies,identities])):null;};
  const currentProof=cached?proof(saved.usedKeys,saved.counts):null;
  if(currentProof&&saved.inputHash===currentProof){bytes=cached;stats.reused++;}else{
   // A LAWD quarter can contain more than one province binding. Read it once,
   // then preserve the existing province/date order without deduplicating rows.
   const buckets=provinces.map(()=>[]);
   for(const[code,r]of quarterRegions){const fallback=provinces.findIndex(p=>r.metadata.complexes.some(c=>c.r===p));
    for(const row of compactMarketShard(reader.regionMonth(code,month,false)).rows){const c=catalog[row[0]];if(!c)throw Error('Unknown market complex');const bucket=provinces.indexOf(c.r);buckets[bucket<0?fallback:bucket].push(row);}
   }
   const rows=buckets.flatMap(rows=>rows.sort((a,b)=>a[2]-b[2]));
   stats.decoded++;
   // Preserve order and duplicate multiplicity. These are exactly the fields
   // summarize consumes; date, source labels and sale-only changes are irrelevant.
   const keys=new Set();
   const semanticHash=hash(JSON.stringify(rows.map(r=>{const c=catalog[r[0]];if(!c)throw Error('Unknown market complex');keys.add(c.key);return [r[1],r[3],r[4],r[5],r[7],c.r,c.g];})));
   const usedKeys=[...keys].sort();
   if(cached&&saved.semanticHash===semanticHash){bytes=cached;stats.reused++;stats.semanticReused++;}
   else{bytes=gzipSync(JSON.stringify({schema:2,month,groups:M.summarize(rows,catalog)}),{level:6});cache.write(target,bytes);stats.calculated++;}
   cache.write(stamp,JSON.stringify({schema:4,codeHash,inputHash:proof(usedKeys,counts),usedKeys,counts,semanticHash,hash:hash(bytes)}));
  }
  (years[month.slice(0,4)]??={})[month]=bytes;
 }
 // Bind every metadata/identity/quarter dependency, even on a reused month.
 Object.assign(inputs,reader.inputs);for(const[p,h]of Object.entries(inputs))reader.physical(p,false);reader.recheck();
 for(const[year,data]of Object.entries(years)){
  const path=prefix+year+'-summary.bin',target=join(directory,year+'-summary.bin'),stamp=target+'.json';
  const dependencyHash=hash(JSON.stringify([FORMAT,packingHash,districtRegions,Object.entries(data).map(([month,b])=>[month,hash(b)])]));let bytes;
  try{if(process.env.NODO_FULL_VERIFY==='1')throw Error('Full verification requested');const saved=JSON.parse(cache.read(stamp)),old=cache.read(target);if(saved.dependencyHash===dependencyHash&&saved.sha256===hash(old)){bytes=old;stats.reusedYears++;}}catch{}
  if(!bytes){const entries=Object.entries(data).map(([month,b])=>{const value=JSON.parse(gunzipSync(b));value.groups.districtRegions=districtRegions;return [month,value];});bytes=gzipSync(encodeRecords(entries),{level:6});if(bytes.length>25*1024*1024)throw Error('Market summary exceeds 25 MiB');cache.write(target,bytes);cache.write(stamp,JSON.stringify({dependencyHash,sha256:hash(bytes)}));stats.packedYears++;}
  sources[path]=hash(bytes);assets.push({path,bytes});
 }
 const sale=join(root,'data/market.json'),saleStartYear=existsSync(sale)?JSON.parse(readFileSync(sale)).meta.startYear:2006;
 assets.push({path:prefix+'index.json',bytes:Buffer.from(JSON.stringify({schema:2,format:FORMAT,sourceVersion:m.version,months,saleStartYear,districts,inputs,sources}))});stats.bytes=assets.reduce((n,a)=>n+a.bytes.length,0);return assets;
 } finally { cache.close(); }
}
