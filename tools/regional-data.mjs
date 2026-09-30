import {readFileSync,realpathSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import '../js/regional-data.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function regionalReader(root,kind){
 root=realpathSync(root);const manifest=JSON.parse(readFileSync(resolve(root,`data/${kind}/index.json`))),inputs={},cache=new Map();
 function physical(path,decode=true){if(decode&&cache.has(path))return cache.get(path);const p=resolve(root,path);if(!p.startsWith(root+sep)||path.includes('..')||!/^data\/(daily|rental|map)\/[\w/.-]+\.(bin|json)$/.test(path))throw Error('Unsafe regional path: '+path);if(!realpathSync(p).startsWith(root+sep))throw Error("Regional source link escapes root");const bytes=readFileSync(p),digest=hash(bytes);if(manifest.sources[path]!==digest)throw Error('Regional source mismatch: '+path);inputs[path]=digest;if(!decode)return {bytes:bytes.length,sha256:digest};const v=JSON.parse(path.endsWith('.bin')?gunzipSync(bytes):bytes);if(path.endsWith('.json')&&path.includes('/regions/')||path.endsWith('/catalog.bin'))cache.set(path,v);return v;}
 if(manifest.schema==null||manifest.schema===1){manifest.schema=1;return {manifest,inputs,physical,get catalog(){return physical(`data/${kind}/catalog.bin`);},read:physical};}
 if(manifest.schema!==2||manifest.regional?.kind!==kind||manifest.regional.format!=='fixed-region')throw Error('Unsupported dataset schema');
 const descriptor=physical(manifest.regional.authority);if(descriptor.baselineCommit!==manifest.regional.baselineCommit)throw Error('Regional baseline mismatch');
 const payloads={};for(const p of new Set(Object.values(descriptor.regions).flatMap(r=>[r.identities,r.metadata])))payloads[p]=physical(p);
 const table=globalThis.NodoRegional.tables(descriptor,payloads,kind);
 function regionMonth(code,month){
  const base=manifest.regional.bases?.[code]?.[month],overlay=manifest.regional.overlays?.[code]?.[month];let shard={rows:[],opening:[],updates:[]};
  if(base){const value=globalThis.NodoRegional.baseMonth(physical(base),code,month,descriptor.baselineCommit);shard={...shard,...value[kind]};}
  return globalThis.NodoRegional.merge(shard,overlay?[physical(overlay)]:[],kind,descriptor.baselineCommit);
 }
 function read(path){
  const match=kind==='daily'?path.match(/^data\/daily\/([012])\/(\d{4}-\d{2})(-state)?\.bin$/):path.match(/^data\/rental\/months\/(\d{4}-\d{2})-(41|11|28)(-state)?\.bin$/);
  if(!match)return physical(path);const month=kind==='daily'?match[2]:match[1],province=kind==='daily'?Number(match[1]):{'41':0,'11':1,'28':2}[match[2]],result={rows:[],opening:[],updates:[]};
  for(const [code,r]of table.regions)if(r.metadata.complexes.some(c=>c.r===province)){const value=regionMonth(code,month);for(const f of Object.keys(result))for(const row of value[f]||[])result[f].push(row);}
  return result;
 }
 function fingerprint(path,metadata=false){const match=kind==='daily'?path.match(/^data\/daily\/([012])\/(\d{4}-\d{2})(-state)?\.bin$/):path.match(/^data\/rental\/months\/(\d{4}-\d{2})-(41|11|28)(-state)?\.bin$/);if(!match)return manifest.sources[path];const month=kind==='daily'?match[2]:match[1],province=kind==='daily'?Number(match[1]):{'41':0,'11':1,'28':2}[match[2]],proof=[];for(const [code,r]of table.regions)if(r.metadata.complexes.some(c=>c.r===province)){for(const p of [manifest.regional.bases?.[code]?.[month],manifest.regional.overlays?.[code]?.[month],metadata?r.entry.metadata:null].filter(Boolean)){inputs[p]=manifest.sources[p];proof.push([p,manifest.sources[p]]);}}return hash(JSON.stringify(proof));}
 return {manifest,inputs,physical,catalog:table,read,table,regionMonth,fingerprint};
}
export function verifyRegionalData(root,kind){
 const reader=regionalReader(root,kind),m=reader.manifest;if(m.schema!==2)throw Error('Schema2 required for regional verification');
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