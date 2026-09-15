import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function summarize(rows) {
  const valid=rows.filter(t=>!(t.flags&6)&&t.price>0).sort((a,b)=>b.date-a.date||a.row-b.row||a.order-b.order);
  const latest=valid[0]||null, yearly={}, monthly={};
  for(const t of valid){const y=String(t.date).slice(0,4),m=String(t.date).slice(0,6);(yearly[y]??=[]).push(t.price);(monthly[m]??=[]).push(t.price);}
  const summarizeGroup=values=>({average:values.reduce((a,b)=>a+b,0)/values.length,min:Math.min(...values),max:Math.max(...values),count:values.length});
  let recent=null;
  if(latest){const year=Math.floor(latest.date/10000),latestMonth=Math.floor(latest.date/100)%100;let subset=[];let start=latestMonth;
    for(;start>=1;start--){subset=valid.filter(t=>Math.floor(t.date/10000)===year&&Math.floor(t.date/100)%100>=start);if(subset.length>=3||start===1)break;}
    recent={value:Math.round(subset.reduce((n,t)=>n+t.price,0)/subset.length/100)*100,count:subset.length,from:year*100+start,to:year*100+latestMonth};
  }
  return {latest,lastFive:valid.slice(0,5),recent,total:valid.length,yearly:Object.fromEntries(Object.entries(yearly).map(([k,v])=>[k,summarizeGroup(v)])),monthly:Object.fromEntries(Object.entries(monthly).map(([k,v])=>[k,summarizeGroup(v)]))};
}
export function buildApartmentData(root,{verify=false}={}) {
  const inputHashes={},read=path=>{const bytes=readFileSync(join(root,path));inputHashes[path]=sha(bytes);return JSON.parse(bytes);};
  const index=read('data/index.json'),map=read('data/map/index.json'),housing=read('data/housing-v3/index.json');
  if(housing.meta.approvedOnly!==true)throw Error('Only approved publications may identify apartments');
  const status=existsSync(join(root,'data/building-status.json'))?read('data/building-status.json').sites:{};
  const bySource=new Map(),locations=new Map();
  for(const r of index.d){if(!r.as)throw Error('Missing stable apartment ID');if(!bySource.has(r.as))bySource.set(r.as,[]);bySource.get(r.as).push(r);}
  for(const c of map.d){locations.set(c.id,c);for(const s of c.memberSources||[])locations.set(s.id,c);}
  const publications=housing.complexes.filter(c=>c.housingFamily==='apartment');
  const claims=new Map();for(const p of publications)for(const k of p.transactionKeys||[]){if(!claims.has(k))claims.set(k,[]);claims.get(k).push(p.id);}
  const ambiguous=[...claims].filter(([,v])=>v.length>1).map(([k])=>k),claimed=new Set(),entities=[];
  for(const p of publications){const keys=(p.transactionKeys||[]).filter(k=>bySource.has(k)),conflict=keys.some(k=>ambiguous.includes(k));
    if(new Set(keys.map(k=>bySource.get(k)[0].r+'|'+bySource.get(k)[0].g)).size>1)throw Error('Cross-district approved group: '+p.id);
    const usable=conflict?[]:keys;usable.forEach(k=>claimed.add(k));
    entities.push({id:p.id,aliases:[...(p.legacyIds||[]),...usable],publication:p,rows:usable.flatMap(k=>bySource.get(k)),conflict});
  }
  for(const [id,rows] of bySource)if(!claimed.has(id))entities.push({id,aliases:[],rows});
  const shards=Object.fromEntries(Array.from({length:256},(_,i)=>[i.toString(16).padStart(2,'0'),{}]));
  const lookup={},legacy={},txCache=new Map();
  const transactions=row=>{const path=`data/tx/${row.g}.json`;if(!txCache.has(path))txCache.set(path,read(path));const data=txCache.get(path);const entry=(data.entries||data)[String(row.i)]||{};
    return Object.entries(entry).flatMap(([year,ts])=>ts.map((t,order)=>({date:Number(year)*10000+t[0]*100+t[1],price:t[2],floor:t[3],flags:t[4]||0,cancelled:t[5]||'',row:row.i,source:row.as,name:row.n,order})));
  };
  for(const e of entities){const p=e.publication,first=e.rows[0],mapRecord=e.rows.map(r=>locations.get(r.as)).find(Boolean),rental=p?.publicationMode==='metadata_only'||p?.tenure==='rental';
    const groupAreas=new Map();for(const row of e.rows){if(!groupAreas.has(row.a))groupAreas.set(row.a,[]);groupAreas.get(row.a).push(row);}
    const areas=[...groupAreas].sort((a,b)=>a[0]-b[0]).map(([area,rows])=>{
      const trades=rental?[]:rows.flatMap(transactions),summary=summarize(trades);
      return {area,units:rows.length===1?rows[0].u??null:null,rows:rows.map(r=>({i:r.i,source:r.as,name:r.n,district:r.g,units:r.u??null,metrics:{cagr:r.c,mdd:r.m,sharpe:r.s,momentum:r.k,land:r.lr||r.ls||null,landKind:r.lr?'registry':'estimate',landVerified:r.lc??null,far:r.fr??null},commentId:'apt_'+r.i})),...summary};
    });
    const years=[...new Set(e.rows.map(r=>r.b).filter(Boolean))].sort(),life=first?status[`${first.r}|${first.g}|${first.d}|${first.j}`]:null;
    const singleSource=new Set(e.rows.map(r=>r.as)).size===1;
    const address=p?.lotAddress||[ ['경기','서울','인천'][first?.r],first?.g,first?.d,first?.j].filter(Boolean).join(' ');
    const road=p?.roadAddress||first?.rd||'';
    const dto={id:e.id,name:p?.name||first.n,address,road,region:p?.region||['경기','서울','인천'][first?.r],units:p?p.units??null:first?.tu??null,years,parking:singleSource?first?.pk??null:null,far:singleSource?first?.fr??null:null,coord:mapRecord?.coord||null,pnus:p?.parcels||mapRecord?.pnus||[],parcelScope:mapRecord?.scope||null,status:life?.status||mapRecord?.status||'unknown',rental,conflict:!!e.conflict,updated:index.meta.updated,propertyUpdated:housing.meta.updated||null,areas,registry:(p?.registry||[]).map(r=>({name:r.dong_name||r.name,purpose:r.purpose,units:r.units})),sources:e.rows.map(r=>r.as).filter((v,i,a)=>a.indexOf(v)===i)};
    const shard=sha(e.id).slice(0,2);shards[shard][e.id]=dto;
    for(const id of [e.id,...e.aliases]){if(Object.hasOwn(lookup,id)&&lookup[id][0]!==e.id)throw Error('Conflicting alias: '+id);lookup[id]=[e.id,shard];}
    for(const row of e.rows)legacy[row.i]=[e.id,row.a];
  }
  const outputs={};
  for(const [key,data] of Object.entries(shards))outputs[`data/apartments/summary/${key}.json`]=JSON.stringify(Object.fromEntries(Object.entries(data).map(([id,a])=>[id,{id,name:a.name,region:a.region,district:a.areas[0]?.rows[0]?.district||a.address.split(' ').slice(1,3).join(' '),address:a.address,updated:a.updated,rental:a.rental,areas:a.areas.map(x=>({area:x.area,latest:x.latest,lastFive:x.lastFive,recent:x.recent}))}])));
  for(const [key,data] of Object.entries(shards))outputs[`data/apartments/${key}.json`]=JSON.stringify(Object.fromEntries(Object.entries(data).map(([id,a])=>[id,{...a,areas:a.areas.map(({lastFive,...rest})=>rest)}])));
  const files=Object.fromEntries(Object.entries(outputs).map(([path,data])=>[path,sha(data)]));
  outputs['data/apartments/index.json']=JSON.stringify({version:1,updated:index.meta.updated,count:entities.length,lookup,legacy,sources:inputHashes,shards:files,ambiguous});
  for(const [path,data] of Object.entries(outputs)){if(verify){if(!existsSync(join(root,path))||readFileSync(join(root,path),'utf8')!==data)throw Error('Apartment data out of date: '+path);}else{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),data);}}
  return {count:entities.length,shards:256,aliases:Object.keys(lookup).length,ambiguous:ambiguous.length,bytes:Object.values(outputs).reduce((n,s)=>n+Buffer.byteLength(s),0),verified:verify};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const arg=process.argv.indexOf('--root');console.log(JSON.stringify(buildApartmentData(arg<0?resolve(dirname(fileURLToPath(import.meta.url)),'..'):resolve(process.argv[arg+1]),{verify:process.argv.includes('--verify')})));}
