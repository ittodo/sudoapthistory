// Complete explicitly reviewed groups from immutable shared facts before packing.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {regionalReader} from './regional-reader.mjs';
import {apartmentShardValues,apartmentShard} from './build-apartment-records.mjs';
import {compactApartmentRecord} from '../js/apartment-records.mjs';
import {displayArea} from '../js/housing-sale-detail.mjs';
import {directSaleRows} from '../js/housing-sale-direct.mjs';
import {summarize} from './build-apartment-data.mjs';
import {privateCache} from './private-cache.mjs';
import * as cacheStore from './cache-store.mjs';
import {partitionDependencies} from '../js/housing-partition.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const code=hash(['./complete-group-sale-areas.mjs','./build-apartment-data.mjs','./regional-reader.mjs','./housing-regional-reader.mjs','../js/housing-sale-detail.mjs','../js/housing-sale-direct.mjs','../js/regional-data.js','../js/housing-quarter.mjs','../js/housing-partition.mjs','../js/housing-validation.mjs','../js/generated/housing-columns.mjs'].map(p=>hash(readFileSync(new URL(p,import.meta.url)))).join('|'));
const order=(a,b)=>b.date-a.date||(a.row??Number.MAX_SAFE_INTEGER)-(b.row??Number.MAX_SAFE_INTEGER)||String(a.source||'').localeCompare(String(b.source||''))||a.order-b.order;
export function mergeSaleSummaries(a,b){
 const stats=kind=>{const out={};for(const key of new Set([...Object.keys(a[kind]||{}),...Object.keys(b[kind]||{})])){const x=a[kind]?.[key],y=b[kind]?.[key];out[key]=!x?y:!y?x:{average:(x.average*x.count+y.average*y.count)/(x.count+y.count),min:Math.min(x.min,y.min),max:Math.max(x.max,y.max),count:x.count+y.count};}return out;};
 const monthly=stats('monthly'),yearly=stats('yearly'),lastFive=[...(a.lastFive||[]),...(b.lastFive||[])].sort(order).slice(0,5),latest=lastFive[0]||null;
 let recent=null;if(latest){const year=Math.floor(latest.date/10000),to=Math.floor(latest.date/100)%100;let count=0,sum=0,from=to;for(;from>=1;from--){const m=monthly[String(year*100+from)];if(m){count+=m.count;sum+=m.average*m.count;}if(count>=3||from===1)break;}recent={value:Math.round(sum/count/100)*100,count,from:year*100+from,to:year*100+to};}
 return {latest,lastFive,recent,total:(a.total||0)+(b.total||0),monthly,yearly};
}
export function addGroupSaleAreas(dto,short,extras){
 const next=structuredClone(dto),summary=structuredClone(short),byArea=new Map(next.areas.map(a=>[a.area,a])),shortByArea=new Map(summary.areas.map(a=>[a.area,a]));
 for(const e of extras){
  let area=byArea.get(e.area);if(!area){const scope=next.displayGroup.householdScope;area={area:e.area,units:scope?.status==='available'?(scope.roundedAreas?.[String(e.area)]??null):null,rows:[],...summarize([]),memberSummaries:{}};byArea.set(e.area,area);}
  const prior={...area,lastFive:shortByArea.get(e.area)?.lastFive||[]},member=next.displayGroup.members.find(m=>m.key===e.source);
  if(area.rows.some(r=>r.source===e.source))throw Error('Duplicate source/area supplement');
  area.rows.push({source:e.source,name:member?.name||e.source,district:e.district,units:null,metrics:{cagr:null,mdd:null,sharpe:null,momentum:null,land:null,landKind:'estimate',landVerified:null,far:null},sharedFacts:true});
  area.memberSummaries??={};area.memberSummaries[e.source]=e.summary;
  const merged=mergeSaleSummaries(prior,e.summary);Object.assign(area,merged);delete area.lastFive;
  shortByArea.set(e.area,{area:e.area,latest:merged.latest,lastFive:merged.lastFive,recent:merged.recent});
 }
 next.areas=[...byArea.values()].sort((a,b)=>a.area-b.area);summary.areas=[...shortByArea.values()].sort((a,b)=>a.area-b.area);
 if(extras.some(e=>e.summary.total)){next.rental=false;summary.rental=false;}
 return {dto:next,short:summary};
}
export function completeGroupSaleAreas(native,output,{commonRoot=output,catalogRoot=output,cacheDir=null}={}){
 native=resolve(native);output=resolve(output);commonRoot=resolve(commonRoot);
 if(native===output)throw Error('Group completion requires a separate native input');
 const read=(root,p)=>JSON.parse(readFileSync(join(root,p))),index=read(native,'data/apartments/index.json'),catalog=read(catalogRoot,'data/apartments/index.json');
 if(index.format==='packed-records-v1')throw Error('Fresh native group input required');
 const housing=read(native,'data/housing-v3/index.json'),groups=housing.complexes.filter(p=>p.displayGroup),result={groups:groups.length,supplemented:0,sourceAreas:0,transactions:0,builtGroups:0,reusedGroups:0,examples:[]};
 if(!groups.length)return result;
 const salePath='data/sale-details/index.json',saleBytes=readFileSync(join(commonRoot,salePath)),sale=JSON.parse(saleBytes);
 if(sale.format!=='sale-fact-references')throw Error('Shared sale reference manifest required');
 catalog.sources[salePath]=hash(saleBytes);
 const scope='cloudflare/dist/group-sale-supplements-v1',directory=cacheDir?join(resolve(cacheDir),'group-sale-supplements-v1'):join(output,scope);
 const cache=cacheDir?{read:cacheStore.readFileSync,write(path,bytes){cacheStore.mkdirSync(dirname(path),{recursive:true});cacheStore.writeFileSync(path,bytes);}}:privateCache(output,scope);
 const reader=regionalReader(commonRoot,'daily',{verifyOnce:true}),values=new Map(),facts=new Map(),sourceAreas=new Map();
 for(const [source,exact]of Object.values(reader.table.areas)){if(!sourceAreas.has(source))sourceAreas.set(source,new Set());sourceAreas.get(source).add(displayArea(Number(exact)));}
 const load=(bucket,summary)=>{const p=apartmentShard(index,bucket,summary);if(!values.has(p)){const b=readFileSync(join(native,p));if(hash(b)!==index.shards[p])throw Error('Native group input changed');values.set(p,apartmentShardValues(b,p,index));}return values.get(p);};
 const regionFacts=code=>{if(!facts.has(code)){facts.set(code,reader.manifest.months.flatMap(month=>reader.regionMonth(code,month,false).rows));while(facts.size>2)facts.delete(facts.keys().next().value);}return facts.get(code);};
 const changed=new Set();
 try{for(const group of groups){
  const bucket=index.lookup[group.id]?.[1];if(!bucket)throw Error('Group native record missing');const details=load(bucket,false),summaries=load(bucket,true),dto=details[group.id],short=summaries[group.id];
  const covered=new Set(dto.areas.flatMap(a=>a.rows.map(r=>r.source+'|'+a.area))),wanted=[];
  for(const m of group.displayGroup.members){const key=reader.table.source.get(m.key);if(!key||reader.table.complexes[key]?.hasSale===false)continue;for(const area of sourceAreas.get(key)||[])if(!covered.has(m.key+'|'+area))wanted.push({source:m.key,area,code:key.slice(0,5),district:reader.table.complexes[key]?.g||''});}
  if(!wanted.length)continue;
  const dependencies={};for(const c of new Set(wanted.map(w=>w.code))){const entry=reader.table.regions.get(c).entry;dependencies[entry.identities]=reader.manifest.sources[entry.identities];for(const p of Object.values(reader.manifest.regional.quarters[c]||{}))for(const path of partitionDependencies(p,reader.manifest.sources))dependencies[path]=reader.manifest.sources[path];}
  const fingerprint=hash(JSON.stringify([code,wanted,dependencies])),key=join(directory,group.id+'.json');let extras;
  try{const old=JSON.parse(cache.read(key));if(old.fingerprint===fingerprint){extras=old.extras;result.reusedGroups++;}}catch{}
  if(!extras){extras=wanted.flatMap(w=>{const rows=directSaleRows(regionFacts(w.code),reader.table,w.source,w.area);return rows.length?[{source:w.source,area:w.area,district:w.district,rows:rows.length,summary:summarize(rows)}]:[];});cache.write(key,JSON.stringify({fingerprint,extras}));result.builtGroups++;}
  // The existing sale manifest already binds most common facts. Do not copy its
  // national dependency list into every apartment entry metadata response.
  for(const[path,digest]of Object.entries(dependencies))if(sale.facts[path]!==digest)catalog.sources[path]=digest;
  if(!extras.length)continue;
  const next=addGroupSaleAreas(dto,short,extras);details[group.id]=next.dto;summaries[group.id]=next.short;changed.add(apartmentShard(index,bucket,false));changed.add(apartmentShard(index,bucket,true));result.supplemented++;result.sourceAreas+=extras.length;result.transactions+=extras.reduce((n,e)=>n+e.rows,0);result.examples.push({id:group.id,areas:extras.map(e=>({source:e.source,area:e.area,rows:e.rows}))});
 }
 for(const p of changed){const raw=Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(values.get(p)).map(([id,v])=>[id,compactApartmentRecord(v,index)]))));mkdirSync(dirname(join(output,p)),{recursive:true});writeFileSync(join(output,p),raw);catalog.shards[p]=hash(raw);}
 catalog.recordMetadataFormat='inherited-stamps-v1';mkdirSync(join(output,'data/apartments'),{recursive:true});writeFileSync(join(output,'data/apartments/index.json'),JSON.stringify(catalog));reader.recheck();return result;
 }finally{cache.close?.();}
}
