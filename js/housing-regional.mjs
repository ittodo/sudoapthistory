import{joinPartition,partitionDescriptor,verifyPartitionSources}from'./housing-partition.mjs';
import{validateManifest,validateRows}from'./housing-validation.mjs';
import{decodeQuarter}from'./housing-quarter.mjs';import{decodeStateFile}from'./housing-state-timeline.mjs';import*as codec from'./generated/housing-columns.mjs';
export async function create(manifest,kind,load){
 if(manifest.schema!==3||manifest.regional?.format!=='packed-region'||manifest.regional.kind!==kind)throw Error('Invalid packed region manifest');
 const descriptor=await load(manifest.regional.authority),payloads={};if(descriptor.schema!==3)throw Error('Invalid packed identity descriptor');
 await Promise.all([...new Set(Object.values(descriptor.regions).flatMap(r=>[r.identities,r.metadata]))].map(async p=>{payloads[p]=await load(p);}));
 const table=globalThis.NodoRegional.tables(descriptor,payloads,kind),quarterCache=new Map(),stateCache=new Map();validateManifest(manifest,table);verifyPartitionSources(manifest.sources,await Promise.all(Object.keys(manifest.sources).filter(p=>p.endsWith('.parts.json')).map(async p=>[p,await load(p)])));
 async function cached(cache,path,make,background){if(!path)return null;if(cache.has(path)){if(!background)load.promote?.(path);return cache.get(path);}const promise=load(path,background).then(async b=>{if(!path.endsWith('.parts.json'))return make(b);partitionDescriptor(b,path,manifest.sources);const values=await Promise.all([...b.leaves.map(x=>x.path),b.order].map(p=>load(p,background)));return joinPartition(b,values.slice(0,-1),values.at(-1),table.regions.get(b.lawd).identity,codec);});cache.set(path,promise);while(cache.size>12)cache.delete(cache.keys().next().value);try{return await promise;}catch(e){if(cache.get(path)===promise)cache.delete(path);throw e;}}
 const paths=(month,province=null)=>[...table.regions].filter(([,r])=>province==null||r.metadata.complexes.some(c=>c.r===province)).flatMap(([code])=>[manifest.regional.quarters?.[code]?.[month],manifest.regional.states?.[code]?.[month]].filter(Boolean));
 async function regionMonth(code,month,background=false,withState=true){const r=table.regions.get(code);if(!r)throw Error('Unknown region');const q=manifest.regional.quarters?.[code]?.[month],st=manifest.regional.states?.[code]?.[month];if(!q){if(st)throw Error('State without quarter');return {rows:[],opening:[],updates:[]};}
  const [quarter,state]=await Promise.all([cached(quarterCache,q,b=>decodeQuarter(b,r.identity,codec,{lawd:code,quarter:month.slice(0,4)+'-Q'+Math.ceil(Number(month.slice(5))/3)}),background),withState?cached(stateCache,st,b=>decodeStateFile(b,codec,{lawd:code,kind}),background):null]);
  if(withState&&st===undefined)throw Error('State coverage missing');return validateRows({...quarter.month(month)[kind],opening:state?state.month(month):[]},code,kind,r.identity);
 }
 return {...table,paths,regionMonth,async shard(path,month,province,background=false){const includeState=path.includes('-state.'),result={rows:[],opening:[],updates:[]},codes=[...table.regions].filter(([,r])=>r.metadata.complexes.some(c=>c.r===province)).map(([code])=>code);
  // Bound concurrent district reads; a whole province no longer waits district-by-district.
  const values=new Array(codes.length);let next=0;await Promise.all(Array.from({length:Math.min(4,codes.length)},async()=>{while(next<codes.length){const i=next++;values[i]=await regionMonth(codes[i],month,background,includeState);}}));
  for(const value of values)for(const f of ['rows','opening','updates'])result[f].push(...value[f]);const date=kind==='daily'?1:2;for(const f of ['rows','updates'])result[f].sort((a,b)=>a[date]-b[date]);return result;
 }};
}
