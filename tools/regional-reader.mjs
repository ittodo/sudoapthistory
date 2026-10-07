import {partitionDependencies} from '../js/housing-partition.mjs';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import '../js/regional-data.js';
import {packedReader} from './housing-regional-reader.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function regionalReader(root,kind,{verifyOnce=false,decodeCache=null}={}){
 root=realpathSync(root);const manifest=JSON.parse(readFileSync(resolve(root,`data/${kind}/index.json`))),inputs={},cache=new Map();
 const verified=new Map(),signature=p=>{const s=statSync(p);return [s.size,s.mtimeMs,s.ctimeMs,s.ino].join('|');};
 function recheck(){if(!verifyOnce)return;for(const[path,proof]of verified){const p=resolve(root,path);if(signature(p)!==proof.signature||hash(readFileSync(p))!==proof.sha256)throw Error('Regional source changed during build: '+path);}}
 function physical(path,decode=true){if(verifyOnce&&verified.has(path)){const proof=verified.get(path),p=resolve(root,path);if(signature(p)!==proof.signature||!realpathSync(p).startsWith(root+sep))throw Error('Regional source changed during build: '+path);if(!decode)return {bytes:proof.size,sha256:proof.sha256};}if(decode&&cache.has(path))return cache.get(path);const p=resolve(root,path);if(!p.startsWith(root+sep)||path.includes('..')||!/^data\/(daily|rental|map)\/[\w/.-]+\.(bin|json)$/.test(path))throw Error('Unsafe regional path: '+path);if(!realpathSync(p).startsWith(root+sep))throw Error("Regional source link escapes root");const bytes=readFileSync(p),digest=hash(bytes);if(manifest.sources[path]!==digest)throw Error('Regional source mismatch: '+path);inputs[path]=digest;if(verifyOnce)verified.set(path,{signature:signature(p),sha256:digest,size:bytes.length});if(!decode)return {bytes:bytes.length,sha256:digest};const raw=path.endsWith('.bin')?gunzipSync(bytes):bytes;const v=['PGHOUSE1','PGSTATE1','PGCOL001'].includes(raw.subarray(0,8).toString())?new Uint8Array(raw):JSON.parse(raw);if(path.endsWith('.json')&&path.includes('/regions/')||path.endsWith('/catalog.bin'))cache.set(path,v);return v;}
 if(manifest.schema===3){const reader=packedReader(kind,manifest,physical,decodeCache?{decodeCache}:undefined);return {manifest,inputs,physical,recheck,...reader,fingerprint(path,metadata=false){const proof=reader.dependencies(path,metadata).map(p=>{if(!manifest.sources[p])throw Error('Missing dependency hash');inputs[p]=manifest.sources[p];return [p,manifest.sources[p]];});return hash(JSON.stringify(proof));}};}
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
  // A province cursor consumes districts together in date order.
  return globalThis.NodoRegional.merge(result,[],kind,descriptor.baselineCommit);
 }
 function fingerprint(path,metadata=false){const match=kind==='daily'?path.match(/^data\/daily\/([012])\/(\d{4}-\d{2})(-state)?\.bin$/):path.match(/^data\/rental\/months\/(\d{4}-\d{2})-(41|11|28)(-state)?\.bin$/);if(!match)return manifest.sources[path];const month=kind==='daily'?match[2]:match[1],province=kind==='daily'?Number(match[1]):{'41':0,'11':1,'28':2}[match[2]],proof=[];for(const [code,r]of table.regions)if(r.metadata.complexes.some(c=>c.r===province)){for(const p of [manifest.regional.bases?.[code]?.[month],manifest.regional.overlays?.[code]?.[month],metadata?r.entry.metadata:null].filter(Boolean)){inputs[p]=manifest.sources[p];proof.push([p,manifest.sources[p]]);}}return hash(JSON.stringify(proof));}
 return {manifest,inputs,physical,catalog:table,read,table,regionMonth,fingerprint};
}
