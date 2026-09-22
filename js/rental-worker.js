'use strict';
importScripts('/js/rental-model.js?v=20260922-regions1','/js/verified-data-cache.js?v=20260921-shared1','/js/rental-map-model.js?v=20260922-regions1','/js/region-price-cache.js?v=20260922-regions1');
const M=globalThis.NodoRental;
const regionPrices=globalThis.NodoRegionPrices.create();
let manifest,catalog,rates,summary,initializing,districtNames;const cache=new Map();let serial=0,prefetchSerial=0;
let activeMapPaths=new Set();
let mapCache,mapCacheLoading;
const mapCachePrefix='data/rental/map-cache/';
function mapPath(month,region,type){const compact=`${mapCachePrefix}${month}-${region}-${type}.bin`;return mapCache?.sources[compact]?compact:`data/rental/months/${month}-${region}-state.bin`;}
async function ensureMapCache(){
  if(!mapCacheLoading)mapCacheLoading=fetch('/'+mapCachePrefix+'index.json',{cache:'no-cache'}).then(async r=>{
    if(!r.ok)return;const m=await r.json();
    if(m.schema!==1||m.sourceVersion!==manifest.version||!m.inputs||!m.sources)return;
    if(Object.entries(m.inputs).some(([p,h])=>manifest.sources[p]!==h))return;
    if(Object.entries(m.sources).some(([p,h])=>!/^data\/rental\/map-cache\/\d{4}-\d{2}-(11|41|28)-(jeonse|monthly)\.bin$/.test(p)||!/^[a-f0-9]{64}$/.test(h)))return;
    mapCache=m;
  }).catch(()=>{});
  await mapCacheLoading;
}
const isMapFile=p=>p.endsWith('-state.bin')||p.startsWith(mapCachePrefix);
let viewPathsKey='';
function beginView(s){
  if(s.detail)return;
  const regions=s.region?[s.region]:M.REGIONS,span=s.map?null:M.range(s.day,s.period);
  const months=s.map?[s.day.slice(0,7)]:M.months(span.from,span.to);
  const wanted=new Set(months.flatMap(month=>regions.map(region=>s.map?mapPath(month,region,s.type):`data/rental/months/${month}-${region}.bin`)));
  const key=[...wanted].sort().join('|');
  if(key===viewPathsKey)return;
  viewPathsKey=key;prefetchSerial++;
  const next=new Date(s.day+'T00:00:00Z');next.setUTCDate(1);next.setUTCMonth(next.getUTCMonth()+1);
  const warm=s.map?new Set(regions.map(region=>mapPath(next.toISOString().slice(0,7),region,s.type))):new Set();
  // Promote a warmed file before cancelling other obsolete downloads.
  for(const [path,entry]of cache){
    if(wanted.has(path))entry.background=false;
    else if((path.startsWith('data/rental/months/')||path.startsWith(mapCachePrefix))&&!entry.settled&&!(entry.background&&warm.has(path))){entry.controller.abort();cache.delete(path);}
  }
  activeMapPaths=s.map?wanted:new Set();
}
let rentalMapModel;
function mapView(...args){return (rentalMapModel??=globalThis.NodoRentalMapModel.create(catalog)).mapView(...args);}
function cancelPrefetch(){
  prefetchSerial++;
  for(const [path,entry]of cache)if(entry.background&&!entry.settled){entry.controller.abort();cache.delete(path);}
}
async function prefetch(s,revision){
  if(s?.zoom<16)return {prefetched:0};
  if(revision!==prefetchSerial||!s?.map||!/^\d{4}-\d{2}-\d{2}$/.test(s.day||''))return {prefetched:0};
  const date=new Date(s.day+'T00:00:00Z');date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+1);
  const month=date.toISOString().slice(0,7);
  if(!s.endMonth||month>s.endMonth)return {prefetched:0};
  const regions=s.region?[s.region]:M.REGIONS,paths=regions.map(region=>mapPath(month,region,s.type)).filter(path=>manifest.sources[path]||mapCache?.sources[path]);
  const results=await Promise.allSettled(paths.map(path=>load(path,true)));
  return {prefetched:results.filter(r=>r.status==='fulfilled').length,failed:results.filter(r=>r.status==='rejected').length,cancelled:revision!==prefetchSerial};
}
const fileCache=globalThis.NodoVerifiedDataCache.create('nodo-rental-map-v1');
async function download(path,expected,entry,background){
  return fileCache.download(path,expected,{signal:entry.controller.signal,background,persist:path.startsWith(mapCachePrefix)});
}
async function load(path,background=false){
  if(cache.has(path)){const entry=cache.get(path);if(!background)entry.background=false;cache.delete(path);cache.set(path,entry);return entry.promise;}
  const expected=mapCache?.sources[path]||manifest.sources[path];if(!expected)throw Error('수집된 자료가 없는 구간입니다.');
  const entry={background,controller:new AbortController(),settled:false};
  entry.promise=(async()=>{const bytes=await download(path,expected,entry,background);entry.controller.signal.throwIfAborted();const text=path.endsWith('.bin')?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes);entry.controller.signal.throwIfAborted();return JSON.parse(text);})();
  cache.set(path,entry);const large=isMapFile(path),peers=[...cache.keys()].filter(k=>isMapFile(k)===large);
  if(peers.length>(large?6:9)){const oldest=peers.find(k=>!activeMapPaths.has(k));if(oldest){const old=cache.get(oldest);if(old.background&&!old.settled)old.controller.abort();cache.delete(oldest);}}
  try{return await entry.promise;}catch(e){if(cache.get(path)===entry)cache.delete(path);throw e;}finally{entry.settled=true;}
}
async function init(){if(catalog)return;if(initializing)return initializing;initializing=(async()=>{const r=await fetch('/data/rental/index.json',{cache:'no-cache'});if(!r.ok)throw Error('전월세 자료를 준비 중입니다.');manifest=await r.json();if(manifest.schema!==1)throw Error('자료 형식이 바뀌었습니다. 새로고침해 주세요.');const loaded=await Promise.all([load('data/rental/catalog.bin'),load('data/rental/rates.json')]);[catalog,rates]=[loaded[0].complexes,loaded[1]];districtNames=M.normalizeDistricts(catalog);})();try{await initializing;}finally{initializing=null;}}
function aggregate(rows,s){
  const out={count:0,cancelled:0,up:0,down:0,high:0,low:0,within:0,unlocated:0},daily={},districts={},rank=new Map();
  for(const t of rows){if(t.cancelled){out.cancelled++;continue;}out.count++;if(!t.c.coord)out.unlocated++;const comparable=s.type==='jeonse'||s.convert;for(const [k,bit]of Object.entries({up:8,down:4,high:1,low:2,within:16}))if(comparable&&t.records&bit)out[k]++;
    const value=M.metric(t,s),keys=[t.date,t.c.g+' · '+['미상','신규','갱신'][t.contract]];
    for(const [store,key]of [...(s.panels?.daily===false?[]:[[daily,keys[0]]]),...(s.panels?.districts===false?[]:[[districts,keys[1]]])]){const a=store[key]??={count:0,n:0,sum:0,deposit:0,rent:0};a.count++;a.deposit+=t.deposit;a.rent+=t.rent;if(value!=null){a.sum+=value;a.n++;}}
    if(s.panels?.rank===false)continue;const key=t.ci+':'+t.area+':'+t.contract;const a=rank.get(key)||{name:t.c.n,publicId:t.c.publicId,ci:t.ci,area:t.area,contract:t.contract,count:0,sum:0,n:0};a.count++;if(value!=null){a.sum+=value;a.n++;}rank.set(key,a);
  }
  return {stats:out,daily,districts,rank:[...rank.values()].sort((a,b)=>(b.n?b.sum/b.n:-Infinity)-(a.n?a.sum/a.n:-Infinity)).slice(0,100)};
}
self.onmessage=async({data})=>{if(data.action==='cancel-prefetch'){cancelPrefetch();postMessage({id:data.id,cancelled:true});return;}const revision=data.action==='view'?++serial:serial;if(data.action==='prefetch')cancelPrefetch();const backgroundRevision=prefetchSerial;try{if(data.action==='view'){const s=data.settings;if(!s.map||s.zoom>=16||!globalThis.NodoRegionPrices.eligible(s,s.type))regionPrices.cancel();beginView(s);}await init();if(data.settings?.map){await ensureMapCache();if(data.action==='view'&&revision===serial)beginView(data.settings);}if(data.action==='view'&&revision!==serial){postMessage({id:data.id,stale:true});return;}if(data.action==='prefetch'){postMessage({id:data.id,...await prefetch(data.settings,backgroundRevision)});return;}if(data.action==='init'){let lastDate=manifest.months.at(-1)+'-01';const regionIndex=data.settings?.map?await regionPrices.index():null;if(regionIndex?.versions.rental===manifest.version&&regionIndex.rentalMaxDate)lastDate=regionIndex.rentalMaxDate;else {const latest=await Promise.all(M.REGIONS.map(region=>load(`data/rental/months/${manifest.months.at(-1)}-${region}.bin`)));for(const shard of latest)for(const row of shard.rows)if(M.iso(row[2])>lastDate)lastDate=M.iso(row[2]);}postMessage({id:data.id,meta:{detail:data.settings?.detail?catalog.find(c=>[c.id,c.publicId,c.mapId].includes(data.settings.detail)):null,lastDate,months:manifest.months,coverage:manifest.coverage,historyYears:manifest.historyYears,rates,regions:M.REGIONS,districtsByRegion:Object.fromEntries(M.REGIONS.map(region=>[region,[...new Set(catalog.filter(c=>M.REGIONS[c.r]===region).map(c=>c.g))].sort((a,b)=>a.localeCompare(b,'ko'))]))},districtNames,districts:[...new Set(catalog.map(c=>c.g))].sort((a,b)=>a.localeCompare(b,'ko'))});return;}
  const s=M.cleanFilters(data.settings),regions=s.region?[s.region]:M.REGIONS;let raw=[];let coverage=[];
  if(s.map){
    if(s.zoom<16&&!s.regionCacheDisabled&&globalThis.NodoRegionPrices.eligible(s,s.type)){
      cancelPrefetch();for(const [p,e]of cache)if(isMapFile(p)&&!e.settled){e.controller.abort();cache.delete(p);}
      const result=await regionPrices.get(s.type,s.day,regions,{rental:manifest.version},s.convert);
      if(revision!==serial){postMessage({id:data.id,stale:true});return;}
      if(result){const b=s.bounds;result.points=result.points.filter(p=>!b||(p.coord[0]>=b.south&&p.coord[0]<=b.north&&p.coord[1]>=b.west&&p.coord[1]<=b.east));postMessage({id:data.id,...result,version:manifest.version});return;}
    }
    activeMapPaths=new Set(regions.map(region=>mapPath(s.day.slice(0,7),region,s.type)));
    const shards=await Promise.all(regions.map(region=>{const path=mapPath(s.day.slice(0,7),region,s.type);return (manifest.sources[path]||mapCache?.sources[path])?load(path):null;}));
    if(data.action==='view'&&revision!==serial){postMessage({id:data.id,stale:true});return;}
    postMessage({id:data.id,...mapView(shards,regions,s),version:manifest.version});return;
  }
  if(s.detail){const wanted=new Set([s.detail,...(data.action==='history'?data.settings.detailIds||[]:[])]);const ids=catalog.map((c,i)=>[c.publicId,c.id,c.mapId].some(id=>wanted.has(id))?i:-1).filter(i=>i>=0);const buckets=[...new Set(ids.map(i=>i%64))];for(const b of buckets){const path=`data/rental/history/${s.year}/${String(b).padStart(2,'0')}.bin`;if(manifest.sources[path])raw.push(...(await load(path)).rows.filter(r=>ids.includes(r[0])));}}

  else{const span=M.range(s.day,s.period),paths=[];for(const month of M.months(span.from,span.to))for(const region of regions){const path=`data/rental/months/${month}-${region}.bin`;if(manifest.sources[path])paths.push(path);}for(const shard of await Promise.all(paths.map(path=>load(path))))raw.push(...shard.rows.filter(r=>M.iso(r[2])>=span.from&&M.iso(r[2])<=span.to));}
  if(data.action==='view'&&revision!==serial){postMessage({id:data.id,stale:true});return;}
  if(data.action==='history'){postMessage({id:data.id,rows:raw.map(r=>M.decode(r,catalog))});return;}
  const rows=raw.map(r=>M.decode(r,catalog)).filter(t=>M.match(t,s));const totals=aggregate(rows,s),filtered=rows.filter(t=>M.category(t,s));
  const key=t=>s.sort==='deposit'?t.deposit:s.sort==='rent'?t.rent:s.sort==='rise'?(M.change(t,s)??-Infinity):s.sort==='drop'?-(M.change(t,s)??Infinity):s.sort==='date'?Date.parse(t.date):M.metric(t,s)??-Infinity;
  const sortKeys=new Map(filtered.map(t=>[t,key(t)]));
  filtered.sort((a,b)=>sortKeys.get(b)-sortKeys.get(a)||b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  const count=filtered.length;const page=filtered.slice(0,s.limit||50).map(t=>({...t,change:M.change(t,s),annual:M.annual(t,s)}));
  const points=s.map?filtered.filter(t=>t.c.coord).map(t=>({ci:t.ci,area:t.area,contract:t.contract,date:t.date,coord:t.c.coord,name:t.c.n,publicId:t.c.publicId,deposit:t.deposit,rent:t.rent,value:M.metric(t,s),rate:t.rate,rateMonth:t.rateMonth,records:t.records})):[];
  for(const region of regions){const partitions=Object.entries(manifest.coverage).filter(([lawd])=>lawd.startsWith(region));const selectedMonths=s.detail?manifest.months.filter(m=>m.startsWith(s.year)):M.months(M.range(s.day,s.period).from,M.range(s.day,s.period).to);coverage.push({region,districts:partitions.length,available:partitions.filter(([,v])=>selectedMonths.some(m=>v[m])).length,first:partitions.length?Object.keys(partitions.flatMap(([,v])=>Object.keys(v)).reduce((a,v)=>(a[v]=1,a),{})).sort()[0]:null});}
  if(s.panels?.trend!==false&&!summary)summary=await load('data/rental/summary.json');
  const trend=[];if(s.panels?.trend!==false)for(const [month,byRegion]of Object.entries(summary)){for(const region of regions)for(const [contract,a]of Object.entries(byRegion[region]?.[s.type]||{})){if(s.contract!=='all'&&String(s.contract)!==contract)continue;trend.push({month,region,contract,count:a[0],deposit:a[1]/a[0],rent:a[2]/a[0],value:a[4]?a[3]/a[4]:null});}}
  const values=s.panels?.histogram===false?[]:filtered.filter(t=>!t.cancelled).map(t=>M.metric(t,s)).filter(v=>v!=null);let histogram=[];
  if(values.length){let hi=0;for(const v of values)hi=Math.max(hi,v);const width=Math.max(1,Math.ceil(hi/10));histogram=Array.from({length:10},(_,i)=>({low:i*width,high:(i+1)*width,count:0}));for(const v of values)histogram[Math.min(9,Math.floor(v/width))].count++;}
  postMessage({id:data.id,...totals,rows:page,count,points,coverage,trend,histogram,version:manifest.version});
}catch(error){postMessage(data.action==='view'&&revision!==serial?{id:data.id,stale:true}:{id:data.id,error:error.message});}};
