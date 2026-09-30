'use strict';
importScripts('/js/rental-model.js?v=20260928-market1','/js/market-rental-model.js?v=20260928-market1','/js/verified-data-cache.js?v=20260921-shared1','/js/regional-data.js?v=20260930-regional1');
const M=globalThis.NodoMarketRental,R=globalThis.NodoRental;
let verified=globalThis.NodoVerifiedDataCache.create('nodo-rental-market-v1',1024);
let manifest,index,catalog,initializing,regional,serial=0,activeReads=0;const files=new Map(),summaries=new Map(),waiting=[];
async function read(path,expected,signal){
  if(activeReads>=3)await new Promise(resolve=>waiting.push(resolve));else activeReads++;
  try{signal?.throwIfAborted();const bytes=await verified.download(path,expected,{signal});return JSON.parse(path.endsWith('.bin')?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes));}
  finally{const next=waiting.shift();if(next)next();else activeReads--;}
}
async function init(){if(catalog)return;if(initializing)return initializing;initializing=(async()=>{
  const r=await fetch('/data/rental/index.json',{cache:'no-cache'});if(!r.ok)throw Error('전월세 자료를 불러오지 못했습니다.');manifest=await r.json();if(![1,2].includes(manifest.schema))throw Error('자료 형식을 확인해 주세요.');
  const r2=await fetch('/data/rental/market-cache/index.json',{cache:'no-cache'});if(r2.ok){const candidate=await r2.json();if(candidate.schema===1&&candidate.sourceVersion===manifest.version&&candidate.inputs&&candidate.sources&&Object.entries(candidate.inputs).every(([p,h])=>manifest.sources[p]===h)&&Object.entries(candidate.sources).every(([p,h])=>/^data\/rental\/market-cache\/\d{4}-(0[1-9]|1[0-2])-(11|41|28)\.bin$/.test(p)&&/^[a-f0-9]{64}$/.test(h)))index=candidate;}
  // Keep the complete history, including one previous version during updates.
  verified=globalThis.NodoVerifiedDataCache.create('nodo-rental-market-v1',Math.max(1024,manifest.months.length*6+2));
  regional=manifest.schema===2?await globalThis.NodoRegional.create(manifest,'rental',(p)=>read(p,manifest.sources[p])):null;catalog=regional?regional.complexes:(await read('data/rental/catalog.bin',manifest.sources['data/rental/catalog.bin'])).complexes;R.normalizeDistricts(catalog);
})();try{await initializing;}finally{initializing=null;}}
async function load(month,region){const compact=`data/rental/market-cache/${month}-${region}.bin`,original=`data/rental/months/${month}-${region}.bin`,path=index?.sources[compact]?compact:original,hash=(index?.sources[compact])||manifest.sources[original];if(!hash&&!regional)return null;
  if(files.has(path)){const entry=files.get(path);files.delete(path);files.set(path,entry);return entry.promise;}
  const entry={controller:new AbortController(),settled:false};entry.promise=(regional&&path!==compact?regional.shard(original,month,{'41':0,'11':1,'28':2}[region]):read(path,hash,entry.controller.signal)).then(shard=>path===compact?shard.rows:shard.rows.filter(r=>!r[7]).map(r=>[r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[16],r[15],r[17]]));files.set(path,entry);
  try{return await entry.promise;}catch(e){if(files.get(path)===entry)files.delete(path);throw e;}finally{entry.settled=true;for(const [old,e]of files){if(files.size<=12)break;if(e.settled)files.delete(old);}}
}
function cancelPending(keep=new Set()){for(const [path,entry]of files)if(!entry.settled&&!keep.has(path)){entry.controller.abort();files.delete(path);}}
function required(s){const first=manifest.months[0],last=manifest.months.at(-1),start=[first,s.from+'-01'].sort().at(-1),end=[last,s.to+'-12'].sort()[0],display=M.months(start,end),needed=[...new Set([...display,s.ref,M.shift(s.ref,-1),M.shift(s.ref,-2),M.shift(s.ref,-12)])].filter(m=>m>=first&&m<=last).sort(),regions=s.region?[s.region]:['11','41','28'];return {display,needed,regions};}
const filterKey=s=>JSON.stringify([s.type,s.region,[...(s.gus||[])].sort(),s.contract,s.q,s.searchIds,...['areaMin','areaMax','depositMin','depositMax','rentMin','rentMax'].map(k=>s[k])]);
async function view(s,id,revision){
  const {display,needed,regions}=required(s);
  const key=filterKey(s),results={};let completed=0,next=0;
  // At most three downloads at a time; a superseded view stops scheduling work.
  async function consume(){while(next<needed.length&&revision===serial){const month=needed[next++],cacheKey=key+':'+month;let value=summaries.get(cacheKey);if(!value){const rows=[];let available=0;for(const region of regions){if(revision!==serial)return;const shard=await load(month,region);if(shard){available++;for(const row of shard)rows.push(row);}}
      if(revision!==serial)return;value={...M.aggregate(rows,catalog,s),available,expected:regions.length};summaries.set(cacheKey,value);while(summaries.size>800)summaries.delete(summaries.keys().next().value);
    }results[month]=value;completed++;postMessage({id,progress:{completed,total:needed.length}});}}
  await Promise.all(Array.from({length:3},consume));if(revision!==serial)return {stale:true};
  const rows=[];for(const region of regions){const shard=await load(s.ref,region);if(revision!==serial)return {stale:true};for(const row of shard||[])if(M.matches(row,catalog[row[0]],s))rows.push(row);}
  rows.sort((a,b)=>b[2]-a[2]||String(a[9]).localeCompare(String(b[9])));
  const page=rows.slice(0,Math.min(Math.max(50,s.limit||50),rows.length)).map(row=>({ci:row[0],area:row[1],date:R.iso(row[2]),deposit:row[3],rent:row[4],contract:row[5],floor:row[6],rate:row[7],rateMonth:row[8],id:row[9],values:M.values(row,s.type),c:catalog[row[0]]}));
  return {months:display,data:results,rows:page,rowCount:rows.length,version:manifest.version};
}
self.onmessage=async({data})=>{
  const revision=++serial;
  try{
    await init();if(revision!==serial){postMessage({id:data.id,stale:true});return;}
    if(data.action==='init'){
      postMessage({id:data.id,meta:{months:manifest.months,saleStartYear:index?.saleStartYear||2006,version:manifest.version,districts:Object.fromEntries(['11','41','28'].map(r=>[r,[...new Set(catalog.filter(c=>M.codes[c.r]===r).map(c=>c.g))].sort((a,b)=>a.localeCompare(b,'ko'))]))}});return;
    }
    const {needed,regions}=required(data.settings),keep=new Set();for(const month of needed)for(const region of regions)for(const kind of ['months','market-cache'])keep.add(`data/rental/${kind}/${month}-${region}.bin`);cancelPending(keep);
    postMessage({id:data.id,...await view(data.settings,data.id,revision)});
  }catch(e){
    if(revision!==serial){postMessage({id:data.id,stale:true});return;}
    serial++;cancelPending();postMessage({id:data.id,error:e.message||'시장 자료를 불러오지 못했습니다.'});
  }
};
