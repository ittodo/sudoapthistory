import{joinPartition,partitionDescriptor,verifyPartitionSources}from'./housing-partition.mjs';
import{statePayload}from'./housing-state-bundle.mjs';
import{validateManifest,validateRows}from'./housing-validation.mjs';
import{decodeQuarter}from'./housing-quarter.mjs';import{decodeStateFile}from'./housing-state-timeline.mjs';import*as codec from'./generated/housing-columns.mjs';
import{decodeMapQuarter}from'./housing-map-quarter.mjs';
export async function create(manifest,kind,load,{codes=null}={}){
 if(manifest.schema!==3||manifest.regional?.format!=='packed-region'||manifest.regional.kind!==kind)throw Error('Invalid packed region manifest');
 let descriptor=await load(manifest.regional.authority);const payloads={};if(descriptor.schema!==3)throw Error('Invalid packed identity descriptor');
 if(codes){
  const selected=new Set(codes),loaded=new Set();
  for(;;){const pending=[...selected].filter(code=>!loaded.has(code));if(!pending.length)break;
   await Promise.all(pending.map(async code=>{const r=descriptor.regions[code];if(!/^\d{5}$/.test(code)||!r)throw Error('Unknown selected region');await Promise.all([r.identities,r.metadata].map(async p=>{payloads[p]=await load(p);}));loaded.add(code);for(const c of payloads[r.metadata].complexes)if(c.representativeKey)selected.add(c.representativeKey.split(':')[0]);}));
  }
  descriptor={...descriptor,regions:Object.fromEntries([...selected].map(code=>[code,descriptor.regions[code]]))};
  const filter=values=>Object.fromEntries(Object.entries(values||{}).filter(([code])=>selected.has(code)));
  const sources=Object.fromEntries(Object.entries(manifest.sources).filter(([p])=>p===manifest.regional.authority||[...selected].some(code=>p.startsWith('data/daily/regions/'+code+'/'))));
  manifest={...manifest,sources,regional:{...manifest.regional,quarters:filter(manifest.regional.quarters),states:filter(manifest.regional.states),...(manifest.regional.stateSections?{stateSections:Object.fromEntries(Object.entries(manifest.regional.stateSections).filter(([p])=>sources[p]))}:{})}};
 }else await Promise.all([...new Set(Object.values(descriptor.regions).flatMap(r=>[r.identities,r.metadata]))].map(async p=>{payloads[p]=await load(p);}));
 const table=globalThis.NodoRegional.tables(descriptor,payloads,kind),quarterCache=new Map(),stateCache=new Map(),shards=new Map(),openedFiles=new WeakMap(),pendingReads=new Set();validateManifest(manifest,table);verifyPartitionSources(manifest.sources,await Promise.all(Object.keys(manifest.sources).filter(p=>p.endsWith('.parts.json')).map(async p=>[p,await load(p)])));
 async function cached(cache,path,make,background,view='full'){
  if(!path)return null;const key=view+'|'+path;
  if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);if(!background)load.promote?.(path);return value.promise;}
  const entry={path,key,cache,paths:new Set([path]),settled:false};pendingReads.add(entry);
  const promise=Promise.resolve().then(()=>load(path,background)).then(async bytes=>{
   // Keep decoded readers with their input object. Evicting a path does not
   // repeat decoding while the file loader still owns the same buffer.
   let views=openedFiles.get(bytes);if(!views){views=new Map();openedFiles.set(bytes,views);}
   if(views.has(key)){entry.opened=views.get(key);entry.paths=entry.opened.paths;return entry.opened.promise;}
   const opened={paths:entry.paths,settled:false,forget(){if(views.get(key)===opened)views.delete(key);}};entry.opened=opened;views.set(key,opened);
   opened.promise=(async()=>{
    if(!path.endsWith('.parts.json'))return make(bytes);
    partitionDescriptor(bytes,path,manifest.sources);
    const members=[...bytes.leaves.map(x=>x.path),bytes.order];for(const member of members)opened.paths.add(member);
    const values=await Promise.all(members.map(p=>load(p,background)));
    const joined=joinPartition(bytes,values.slice(0,-1),values.at(-1),table.regions.get(bytes.lawd).identity,codec);
    if(view!=='map')return joined;
    // Preserve partition ordering and guards. Drop the unused transaction
    // arrays after joining; independent partition projection remains separate.
    const months=new Map();
    for(const month of bytes.months)months.set(month,{[kind]:{rows:[],updates:joined.month(month)[kind].updates}});
    return {month(month){if(!months.has(month))throw Error('Uncovered partition month');return months.get(month);}};
   })();
   try{return await opened.promise;}catch(error){opened.forget();throw error;}finally{opened.settled=true;}
  });
  entry.promise=promise;cache.set(key,entry);while(cache.size>12)cache.delete(cache.keys().next().value);
  try{return await promise;}catch(error){if(cache.get(key)===entry)cache.delete(key);throw error;}finally{entry.settled=true;pendingReads.delete(entry);}
 }
 const paths=(month,province=null)=>[...table.regions].filter(([,r])=>province==null||r.metadata.complexes.some(c=>c.r===province)).flatMap(([code])=>[manifest.regional.quarters?.[code]?.[month],manifest.regional.states?.[code]?.[month]].filter(Boolean));
 async function regionMonth(code,month,background=false,withState=true,mapStateOnly=false){const r=table.regions.get(code);if(!r)throw Error('Unknown region');const q=manifest.regional.quarters?.[code]?.[month],st=manifest.regional.states?.[code]?.[month];if(!q){if(st)throw Error('State without quarter');return {rows:[],opening:[],updates:[]};}
  const scope={lawd:code,quarter:month.slice(0,4)+'-Q'+Math.ceil(Number(month.slice(5))/3)};
  const [quarter,state]=await Promise.all([cached(quarterCache,q,b=>mapStateOnly?decodeMapQuarter(b,r.identity,codec,scope,kind):decodeQuarter(b,r.identity,codec,scope),background,mapStateOnly?'map':'full'),withState?cached(stateCache,st,async b=>decodeStateFile(await statePayload(b,kind,code),codec,{lawd:code,kind}),background):null]);
  if(withState&&st===undefined)throw Error('State coverage missing');return validateRows({...quarter.month(month)[kind],opening:state?state.month(month):[]},code,kind,r.identity);
 }
 function discardPending(cancelledPaths){
  const cancelled=new Set(cancelledPaths),affected=new Set(cancelled);
  // A cancelled partition member also invalidates its pending descriptor reader.
  // Keep settled readers and their input buffers available for reuse.
  for(const entry of pendingReads)if(!entry.opened?.settled&&[...entry.paths].some(path=>cancelled.has(path))){
   affected.add(entry.path);if(entry.cache.get(entry.key)===entry)entry.cache.delete(entry.key);entry.opened?.forget();
  }
  for(const[key,entry]of shards)if(!entry.settled&&entry.paths.some(path=>affected.has(path)))shards.delete(key);
 }
 return {...table,paths,regionMonth,discardPending,async shard(path,month,province,background=false){
  const includeState=path.includes('-state.'),key=month+'|'+province+'|'+includeState;
  if(shards.has(key)){const entry=shards.get(key);shards.delete(key);shards.set(key,entry);if(!background)for(const p of paths(month,province))load.promote?.(p);return entry.promise;}
  const codes=[...table.regions].filter(([,r])=>r.metadata.complexes.some(c=>c.r===province)).map(([code])=>code);
  const entry={settled:false,paths:codes.flatMap(code=>[manifest.regional.quarters?.[code]?.[month],includeState&&manifest.regional.states?.[code]?.[month]].filter(Boolean))};entry.promise=(async()=>{
   const result={rows:[],opening:[],updates:[]};
   // Keep the assembled month: a district cache cannot hold an entire province.
   const values=new Array(codes.length);let next=0;await Promise.all(Array.from({length:Math.min(4,codes.length)},async()=>{while(next<codes.length){const i=next++;values[i]=await regionMonth(codes[i],month,background,includeState,includeState);}}));
   for(const value of values)for(const f of ['rows','opening','updates'])result[f].push(...value[f]);const date=kind==='daily'?1:2;for(const f of ['rows','updates'])result[f].sort((a,b)=>a[date]-b[date]);return result;
  })();shards.set(key,entry);
  try{return await entry.promise;}catch(e){if(shards.get(key)===entry)shards.delete(key);throw e;}
  finally{entry.settled=true;for(const[k,v]of shards)if(shards.size>6&&v.settled)shards.delete(k);}
 }};
}
