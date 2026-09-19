'use strict';
importScripts('/js/rental-model.js');
const M=globalThis.NodoRental;
let manifest,catalog,rates,summary,initializing;const cache=new Map();let serial=0;
async function load(path){
  if(cache.has(path)){const v=cache.get(path);cache.delete(path);cache.set(path,v);return v;}
  const expected=manifest.sources[path];if(!expected)throw Error('수집된 자료가 없는 구간입니다.');
  const promise=(async()=>{const response=await fetch('/'+path+'?v='+manifest.version);if(!response.ok)throw Error('전월세 자료를 불러오지 못했습니다.');const bytes=await response.arrayBuffer();const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');if(digest!==expected)throw Error('자료가 업데이트되었습니다. 새로고침해 주세요.');return path.endsWith('.bin')?JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()):JSON.parse(new TextDecoder().decode(bytes));})();
  cache.set(path,promise);if(cache.size>3)cache.delete(cache.keys().next().value);try{return await promise;}catch(e){cache.delete(path);throw e;}
}
async function init(){if(catalog)return;if(initializing)return initializing;initializing=(async()=>{const r=await fetch('/data/rental/index.json',{cache:'no-cache'});if(!r.ok)throw Error('전월세 자료를 준비 중입니다.');manifest=await r.json();if(manifest.schema!==1)throw Error('자료 형식이 바뀌었습니다. 새로고침해 주세요.');const loaded=await Promise.all([load('data/rental/catalog.bin'),load('data/rental/rates.json'),load('data/rental/summary.json')]);[catalog,rates,summary]=[loaded[0].complexes,loaded[1],loaded[2]];})();try{await initializing;}finally{initializing=null;}}
function aggregate(rows,s){
  const out={count:0,cancelled:0,up:0,down:0,high:0,low:0,within:0,unlocated:0},daily={},districts={},rank=new Map();
  for(const t of rows){if(t.cancelled){out.cancelled++;continue;}out.count++;if(!t.c.coord)out.unlocated++;const comparable=s.type==='jeonse'||s.convert;for(const [k,bit]of Object.entries({up:8,down:4,high:1,low:2,within:16}))if(comparable&&t.records&bit)out[k]++;
    const value=M.metric(t,s),keys=[t.date,t.c.g+' · '+['미상','신규','갱신'][t.contract]];
    for(const [store,key]of [[daily,keys[0]],[districts,keys[1]]]){const a=store[key]??={count:0,n:0,sum:0,deposit:0,rent:0};a.count++;a.deposit+=t.deposit;a.rent+=t.rent;if(value!=null){a.sum+=value;a.n++;}}
    const key=t.ci+':'+t.area+':'+t.contract;const a=rank.get(key)||{name:t.c.n,publicId:t.c.publicId,ci:t.ci,area:t.area,contract:t.contract,count:0,sum:0,n:0};a.count++;if(value!=null){a.sum+=value;a.n++;}rank.set(key,a);
  }
  return {stats:out,daily,districts,rank:[...rank.values()].sort((a,b)=>(b.n?b.sum/b.n:-Infinity)-(a.n?a.sum/a.n:-Infinity)).slice(0,100)};
}
self.onmessage=async({data})=>{const revision=++serial;try{await init();if(data.action==='init'){let lastDate=manifest.months.at(-1)+'-01';for(const region of M.REGIONS){const shard=await load(`data/rental/months/${manifest.months.at(-1)}-${region}.bin`);for(const row of shard.rows)if(M.iso(row[2])>lastDate)lastDate=M.iso(row[2]);}postMessage({id:data.id,meta:{lastDate,months:manifest.months,coverage:manifest.coverage,historyYears:manifest.historyYears,rates,regions:M.REGIONS},districts:[...new Set(catalog.map(c=>c.g))].sort()});return;}
  const s=data.settings,regions=s.region?[s.region]:M.REGIONS;let raw=[];let coverage=[];
  if(s.detail){const ids=catalog.map((c,i)=>c.publicId===s.detail||c.id===s.detail||c.mapId===s.detail?i:-1).filter(i=>i>=0);const buckets=[...new Set(ids.map(i=>i%64))];for(const b of buckets){const path=`data/rental/history/${s.year}/${String(b).padStart(2,'0')}.bin`;if(manifest.sources[path])raw.push(...(await load(path)).rows.filter(r=>ids.includes(r[0])));}}
  else if(s.map){const month=s.day.slice(0,7);for(const region of regions){const path=`data/rental/months/${month}-${region}-state.bin`;if(!manifest.sources[path])continue;const shard=await load(path),latest=new Map();const apply=r=>{if((s.type==='jeonse')!==(r[4]===0))return;if(s.contract!=='all'&&r[5]!==Number(s.contract))return;latest.set(JSON.stringify([r[0],r[1],r[4]>0,r[5]]),r);};shard.opening.forEach(apply);for(const r of shard.updates)if(M.iso(r[2])<=s.day)apply(r);for(const row of latest.values())raw.push(row);}}
  else{const span=M.range(s.day,s.period);for(const month of M.months(span.from,span.to))for(const region of regions){const path=`data/rental/months/${month}-${region}.bin`;if(manifest.sources[path])raw.push(...(await load(path)).rows.filter(r=>M.iso(r[2])>=span.from&&M.iso(r[2])<=span.to));}}
  if(revision!==serial){postMessage({id:data.id,stale:true});return;}
  const rows=raw.map(r=>M.decode(r,catalog)).filter(t=>M.match(t,s));const totals=aggregate(rows,s),filtered=rows.filter(t=>M.category(t,s));
  const key=t=>s.sort==='deposit'?t.deposit:s.sort==='rent'?t.rent:s.sort==='rise'?(M.change(t,s)??-Infinity):s.sort==='drop'?-(M.change(t,s)??Infinity):s.sort==='date'?Date.parse(t.date):M.metric(t,s)??-Infinity;
  filtered.sort((a,b)=>key(b)-key(a)||b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  const count=filtered.length;const page=filtered.slice(0,s.limit||50).map(t=>({...t,change:M.change(t,s),annual:M.annual(t,s)}));
  const points=s.map?filtered.filter(t=>t.c.coord).map(t=>({ci:t.ci,area:t.area,contract:t.contract,date:t.date,coord:t.c.coord,name:t.c.n,publicId:t.c.publicId,deposit:t.deposit,rent:t.rent,value:M.metric(t,s),records:t.records})):[];
  for(const region of regions){const partitions=Object.entries(manifest.coverage).filter(([lawd])=>lawd.startsWith(region));const selectedMonths=s.detail?manifest.months.filter(m=>m.startsWith(s.year)):M.months(M.range(s.day,s.period).from,M.range(s.day,s.period).to);coverage.push({region,districts:partitions.length,available:partitions.filter(([,v])=>selectedMonths.some(m=>v[m])).length,first:partitions.length?Object.keys(partitions.flatMap(([,v])=>Object.keys(v)).reduce((a,v)=>(a[v]=1,a),{})).sort()[0]:null});}
  const trend=[];for(const [month,byRegion]of Object.entries(summary)){for(const region of regions)for(const [contract,a]of Object.entries(byRegion[region]?.[s.type]||{})){if(s.contract!=='all'&&String(s.contract)!==contract)continue;trend.push({month,region,contract,count:a[0],deposit:a[1]/a[0],rent:a[2]/a[0],value:a[4]?a[3]/a[4]:null});}}
  const values=filtered.filter(t=>!t.cancelled).map(t=>M.metric(t,s)).filter(v=>v!=null);let histogram=[];
  if(values.length){let hi=0;for(const v of values)hi=Math.max(hi,v);const width=Math.max(1,Math.ceil(hi/10));histogram=Array.from({length:10},(_,i)=>({low:i*width,high:(i+1)*width,count:0}));for(const v of values)histogram[Math.min(9,Math.floor(v/width))].count++;}
  postMessage({id:data.id,...totals,rows:page,count,points,coverage,trend,histogram,version:manifest.version});
}catch(error){postMessage({id:data.id,error:error.message});}};
