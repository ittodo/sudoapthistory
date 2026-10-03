import{decodeMapQuarter}from'./housing-map-quarter.mjs';
import{joinPartition,partitionDescriptor,verifyPartitionSources}from'../js/housing-partition.mjs';
import{validateManifest,validateRows}from'../js/housing-validation.mjs';
import {decodeQuarter} from '../js/housing-quarter.mjs';
import {decodeStateFile} from '../js/housing-state-timeline.mjs';
import * as codec from '../js/generated/housing-columns.mjs';
const decoded=new Map();
export function packedReader(kind,manifest,physical){
 if(manifest.schema!==3||manifest.regional?.format!=='packed-region'||manifest.regional.kind!==kind)throw Error('Invalid packed manifest');
 const descriptor=physical(manifest.regional.authority),payloads={};if(descriptor.schema!==3)throw Error('Wrong packed identity schema');
 for(const path of new Set(Object.values(descriptor.regions).flatMap(r=>[r.identities,r.metadata])))payloads[path]=physical(path);
 const table=globalThis.NodoRegional.tables(descriptor,payloads,kind),cache=decoded;validateManifest(manifest,table);verifyPartitionSources(manifest.sources,Object.keys(manifest.sources).filter(p=>p.endsWith('.parts.json')).map(p=>[p,physical(p)]));
 function opened(path,decode,view='full'){const code=path.split('/')[3],region=table.regions.get(code),identity=region?.entry.identities,descriptor=path.endsWith('.parts.json')?physical(path):null,deps=descriptor?partitionDescriptor(descriptor,path,manifest.sources):[],key=view+'|'+path+'|'+[path,identity,...deps].map(p=>manifest.sources[p]).join('|');if(cache.has(key)){for(const p of [path,...deps])physical(p,false);const v=cache.get(key);cache.delete(key);cache.set(key,v);return v;}const value=descriptor?joinPartition(descriptor,descriptor.leaves.map(x=>physical(x.path)),physical(descriptor.order),region.identity,codec):decode(physical(path));cache.set(key,value);while(cache.size>4)cache.delete(cache.keys().next().value);return value;}
 function regionMonth(code,month,withState=true,mapStateOnly=false){const region=table.regions.get(code);if(!region)throw Error('Unknown region');const q=manifest.regional.quarters?.[code]?.[month],state=manifest.regional.states?.[code]?.[month];if(!q){if(state)throw Error('Orphan state');return {rows:[],opening:[],updates:[]};}
  const scope={lawd:code,quarter:month.slice(0,4)+'-Q'+Math.ceil(Number(month.slice(5))/3)},quarter=opened(q,b=>mapStateOnly?decodeMapQuarter(b,region.identity,codec,scope,kind):decodeQuarter(b,region.identity,codec,scope),mapStateOnly?'map:'+kind:'full');
  if(withState&&state===undefined)throw Error('Missing state');const opening=withState&&state!==null?opened(state,b=>decodeStateFile(b,codec,{lawd:code,kind})).month(month):[];const value=quarter.month(month)[kind];return validateRows({rows:mapStateOnly?[]:value.rows,updates:value.updates,opening},code,kind,region.identity);
 }
 const match=path=>kind==='daily'?path.match(/^data\/daily\/([012])\/(\d{4}-\d{2})(-state)?\.bin$/):path.match(/^data\/rental\/months\/(\d{4}-\d{2})-(41|11|28)(-state)?\.bin$/);
 function scope(path){const m=match(path);return m?{month:kind==='daily'?m[2]:m[1],province:kind==='daily'?Number(m[1]):{'41':0,'11':1,'28':2}[m[2]],state:!!m[3]}:null;}
 function read(path,mapStateOnly=false){const s=scope(path);if(mapStateOnly&&!s?.state)throw Error('Map state path required');if(!s)return physical(path);const result={rows:[],opening:[],updates:[]};for(const[code,r]of table.regions)if(r.metadata.complexes.some(c=>c.r===s.province)){const value=regionMonth(code,s.month,s.state,mapStateOnly);for(const f of Object.keys(result))result[f].push(...value[f]);}const date=kind==='daily'?1:2;for(const f of ['rows','updates'])result[f].sort((a,b)=>a[date]-b[date]);return result;}
 function dependencies(path,metadata=false){const s=scope(path);if(!s)return [path];return [...table.regions].filter(([,r])=>r.metadata.complexes.some(c=>c.r===s.province)).flatMap(([code,r])=>[r.entry.identities,manifest.regional.quarters?.[code]?.[s.month],s.state?manifest.regional.states?.[code]?.[s.month]:null,metadata?r.entry.metadata:null].filter(Boolean)).flatMap(p=>p.endsWith('.parts.json')?[p,...partitionDescriptor(physical(p),p,manifest.sources)]:[p]).sort();}
 return {table,catalog:table,read,readMapState:path=>read(path,true),regionMonth,dependencies};
}
