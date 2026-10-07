import {ValidationSession} from './validation-session.mjs';
import {partitionDependencies} from '../js/housing-partition.mjs';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import '../js/regional-data.js';
import {packedReader} from './housing-regional-reader.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
import {regionalReader} from './regional-reader.mjs';
export {regionalReader};
export function verifyRegionalData(root,kind){
 const reader=regionalReader(root,kind),m=reader.manifest;if(m.schema===3)return verifyPackedPair(root)[kind];if(m.schema!==2)throw Error('Schema2 required for regional verification');
 for(const path of Object.keys(m.sources))reader.physical(path,false);
 const baseline=reader.physical(m.regional.baselineManifest);if(baseline.schema!==2||baseline.baselineCommit!==m.regional.baselineCommit)throw Error('Invalid regional baseline descriptor');
 for(const [p,h]of Object.entries(baseline.sources))if(m.sources[p]!==h)throw Error('Immutable regional baseline replaced: '+p);
 for(const section of ['bases','overlays'])for(const [code,months]of Object.entries(m.regional[section]||{})){
  if(!reader.table.regions.has(code))throw Error('Unknown LAWD');for(const [month,path]of Object.entries(months)){
   if((path!==`data/daily/regions/${code}/${section==='bases'?'base':'months'}/${month}.bin`&&(section!=='bases'||path!==`data/daily/regions/${code}/base/${month.slice(0,4)}-Q${Math.ceil(Number(month.slice(5))/3)}.bin`))||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Unsafe regional month path');
   const value=section==='bases'?globalThis.NodoRegional.baseMonth(reader.physical(path),code,month,m.regional.baselineCommit):reader.physical(path);if(value.lawd!==code||value.month!==month||value.baselineCommit!==m.regional.baselineCommit||value.previous||value.parent)throw Error('Regional scope mismatch');
   const table=reader.table.regions.get(code).identity;
   for(const k of ['daily','rental'])for(const [field,part]of Object.entries(value[k]||{})){
    if(!['rows','opening','updates'].includes(field))throw Error('Unknown regional field');const rows=section==='bases'?part:[...part.add,...part.remove.map(([row])=>row)];
    for(const row of rows){const local=String(row[0]).split(':');if(local[0]!==code||!/^\d+$/.test(local[1]))throw Error('Invalid compound ID');const n=Number(local[1]);if(k==='daily'?!table.areas[n]:!table.complexes[n])throw Error('Unknown regional identity');const expected=k==='rental'?18:field==='rows'?12:6;if(row.length!==expected)throw Error('Wrong vector width');}
   }
   if(section==='overlays')reader.regionMonth(code,month);
  }
 }
 return {schema:2,files:Object.keys(m.sources).length,regions:reader.table.regions.size,version:m.version,immutableRegionalFiles:Object.keys(baseline.sources).length,legacyCompatibility:false};
}
// Reuse decoded validation only after independently rechecking every current file hash.
// Both views share quarter bytes, so validate them together in one bounded-cache pass.
const verifiedPairs=new Map();
function verifyPackedPair(root){
 const d=regionalReader(root,'daily'),r=regionalReader(root,'rental');if(d.manifest.schema!==3||r.manifest.schema!==3||JSON.stringify(d.manifest.regional.quarters)!==JSON.stringify(r.manifest.regional.quarters))throw Error('Shared quarter binding mismatch');
 const checked=new Map();for(const reader of [d,r])for(const[p,h]of Object.entries(reader.manifest.sources)){if(checked.has(p)){if(checked.get(p)!==h)throw Error('Shared digest mismatch');}else{reader.physical(p,false);checked.set(p,h);}}
 const key=hash(JSON.stringify([d.manifest,r.manifest]));if(verifiedPairs.has(key))return verifiedPairs.get(key);
 const session=new ValidationSession(root,{roots:['tools/regional-data.mjs']});let months=0;
 for(const[code,entries]of Object.entries(d.manifest.regional.quarters))for(const month of Object.keys(entries).sort()){
  const dependencies={};if(d.manifest.regional.states?.[code]?.[month]===undefined||r.manifest.regional.states?.[code]?.[month]===undefined)throw Error('Missing state');for(const reader of [d,r]){
   const entry=reader.table.regions.get(code).entry;
   for(const p of [entry.identities,reader.manifest.regional.quarters[code][month],reader.manifest.regional.states?.[code]?.[month]].filter(Boolean)){
    for(const dep of p.endsWith('.parts.json')?partitionDependencies(p,reader.manifest.sources):[p])dependencies[dep]=reader.manifest.sources[dep];
   }
  }
  session.check('region/'+code+'/'+month,dependencies,()=>{d.regionMonth(code,month);r.regionMonth(code,month);return {status:'PASS'};});months++;
 }session.flush();
 const result=Object.fromEntries([['daily',d],['rental',r]].map(([k,v])=>[k,{schema:3,regions:v.table.regions.size,files:Object.keys(v.manifest.sources).length,regionMonths:months,validation:session.stats,legacyCompatibility:false}]));verifiedPairs.clear();verifiedPairs.set(key,result);return result;
}
