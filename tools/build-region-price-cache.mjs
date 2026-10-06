import {regionalReader} from './regional-data.mjs';
import {createHousingDecodeCache} from './housing-regional-reader.mjs';
import {saleGroupFrames,rentalGroupFrames,priceBindings} from './region-price-groups.mjs';
import {readFileSync,writeFileSync,existsSync,mkdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import vm from 'node:vm';

const hash=b=>createHash('sha256').update(b).digest('hex'),prefix='data/map/price-cache/';
const models=['map-model','daily-model','rental-model','rental-map-model'];
export function regionModels(root){const ctx=vm.createContext({});for(const name of models)vm.runInContext(readFileSync(join(root,'js',name+'.js'),'utf8'),ctx);return ctx;}
export function packFrames(days,snapshot){
  let previous=new Map(),previousPoints=new Map();const updates=[];let opening;
  for(const day of days){const value=snapshot(day),next=new Map(value.regions),changed=[],points=new Map((value.meta.points||[]).map(p=>[p.ci,p])),pointChanges=[];
    delete value.meta.points;
    for(const [id,p]of points)if(JSON.stringify(p)!==JSON.stringify(previousPoints.get(id)))pointChanges.push([id,p]);
    for(const id of previousPoints.keys())if(!points.has(id))pointChanges.push([id,null]);
    for(const [id,row]of next)if(JSON.stringify(row)!==JSON.stringify(previous.get(id)))changed.push([id,row]);
    for(const id of previous.keys())if(!next.has(id))changed.push([id,null]);
    if(!opening)opening={...value,points:[...points]};else updates.push({day,regions:changed,points:pointChanges,meta:value.meta});previous=next;previousPoints=points;
  }
  return {schema:1,opening,updates};
}
export function rentalFrames(ctx,catalog,shard,month,region,type){
  const model=ctx.NodoRentalMapModel.create(catalog),days=[month+'-00',...new Set(shard.updates.map(r=>ctx.NodoRental.iso(r[2])))].sort();
  return packFrames(days,day=>{
    const raw=model.mapView([shard],[region],{day,type,contract:'all',kind:'all',compactMap:true,convert:false,bundle:true});
    return {regions:raw.totals,meta:{count:raw.count,complexCount:raw.complexCount,stats:raw.stats,points:raw.points}};
  });
}
export function saleFrames(ctx,catalog,payload,shard,month){
  const original=new Map(payload.d.flatMap(c=>[[c.id,c],...(c.memberSources||[]).map(s=>[s.id,c])])),group=ctx.NodoMapModel.createPriceGroups(catalog,original,ctx.NodoDailyModel),cursor=ctx.NodoDailyModel.priceCursor(shard);
  const days=[month+'-00',...new Set(shard.updates.map(r=>ctx.NodoDailyModel.iso(r[1])))].sort();
  return packFrames(days,day=>{
    const f=cursor.seek(Number(day.replaceAll('-',''))),result=group.update({values:[f.values],changes:f.events,reset:f.reset},{});
    const matches=result.complexes.map(c=>ctx.NodoMapModel.match(c,{})).filter(Boolean);
    return {regions:[...ctx.NodoMapModel.regionGroups(matches)].map(([id,members])=>{const s=ctx.NodoMapModel.clusterTotals(members);return [id,[s.count,s.pricedCount,s.sum]];}),meta:{complexCount:matches.length,count:matches.length}};
  });
}
export function regionPriceAssets(root,{months,stats={},reference=false}={}){
  if(!existsSync(join(root,'data/map/index.json'))||!existsSync(join(root,'data/daily/index.json'))||!existsSync(join(root,'data/rental/index.json')))return [];
  const ctx=regionModels(root),assets=[],sources={},inputs={},directory=join(root,reference?'cloudflare/dist/region-price-reference-v1':'cloudflare/dist/region-price-cache-v2');
  Object.assign(stats,{computedGroups:0,reusedGroups:0,decoratedGroups:0,rentalStateParses:0,reusedMonths:0,writtenMonths:0,reusedQuarters:0,writtenQuarters:0,invalidReceipts:0,invalidationReasons:{missing:0,inputs:0,engine:0,corrupt:0}});
  const saleMonths=new Map(),rentalMonths=new Map(),full=process.env.NODO_FULL_VERIFY==='1';
  for(const p of [join(root,'cloudflare'),join(root,'cloudflare/dist'),directory])if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('Symlink region cache output');mkdirSync(directory,{recursive:true});
  const read=p=>readFileSync(join(root,p)),snapshots=new Map(['data/map/index.json','data/daily/index.json','data/rental/index.json'].map(p=>[p,read(p)])),json=p=>JSON.parse(snapshots.get(p)||read(p)),payload=json('data/map/index.json'),sale=json('data/daily/index.json'),rental=json('data/rental/index.json');
  const verified=(path,manifest)=>{const b=read(path);if(hash(b)!==manifest.sources[path])throw Error('Region cache input changed: '+path);inputs[path]=hash(b);return JSON.parse(path.endsWith('.bin')?gunzipSync(b):b);};
  const saleDecodeCache=createHousingDecodeCache(),rentalDecodeCache=createHousingDecodeCache(),saleReader=regionalReader(root,'daily',{verifyOnce:!reference&&!full,decodeCache:saleDecodeCache}),rentReader=regionalReader(root,'rental',{verifyOnce:!reference&&!full,decodeCache:rentalDecodeCache}),saleCatalog=saleReader.catalog,rentalCatalog=rentReader.catalog.complexes;
  sale.schema??=1;rental.schema??=1;ctx.NodoRental.normalizeDistricts(rentalCatalog);
  const enginePaths=['tools/build-region-price-cache.mjs','tools/region-price-groups.mjs','tools/regional-data.mjs','js/regional-data.js',...(sale.schema===3?['tools/housing-regional-reader.mjs','tools/housing-map-quarter.mjs','js/housing-quarter.mjs','js/housing-facts.mjs','js/housing-state-timeline.mjs','js/housing-validation.mjs','js/housing-partition.mjs','js/generated/housing-columns.mjs']:[]),...models.map(n=>'js/'+n+'.js')],codeHash=hash(Buffer.concat(enginePaths.map(read)));
  const mapHash=hash(snapshots.get('data/map/index.json')),membershipHash=hash(JSON.stringify(payload.d.map(c=>[c.id,c.r,c.admin,c.memberSources?.map(s=>s.id)])));inputs['data/map/index.json']=mapHash;
  const owners=new Map(payload.d.flatMap(c=>[[c.id,c],...(c.memberSources||[]).map(x=>[x.id,c])]));
  let rentalMaxDate=rental.months.at(-1)+'-01';
  for(const region of ['41','11','28']){const path='data/rental/months/'+rental.months.at(-1)+'-'+region+'.bin';if(rental.schema>=2||rental.sources[path])for(const row of rentReader.read(path).rows){const day=ctx.NodoRental.iso(row[2]);if(day>rentalMaxDate)rentalMaxDate=day;}}

  // Process both rental views together so their province/month state is parsed
  // once and shared; bound retained decoded state to one month, not all history.
  const tasks=reference?['sale','jeonse','monthly'].flatMap(type=>(type==='sale'?sale:rental).months.map(month=>({type,month}))):[...sale.months.map(month=>({type:'sale',month})),...rental.months.flatMap(month=>['jeonse','monthly'].map(type=>({type,month})))];
  let rentalMonth;
  for(const {type,month} of tasks.filter(t=>!months||months.includes(t.month))){
    const manifest=type==='sale'?sale:rental;
    if(type!=='sale'&&rentalMonth!==month){rentalMonths.clear();rentalMonth=month;}
    for(const [r,region]of ['41','11','28'].entries()){
      const input=type==='sale'?`data/daily/${r}/${month}-state.bin`:`data/rental/months/${month}-${region}-state.bin`;
      if(manifest.schema===1&&!manifest.sources[input])continue;const reader=type==='sale'?saleReader:rentReader;
      const raw=manifest.schema===1?read(input):null,inputHash=manifest.schema>=2?reader.fingerprint(input,true):hash(raw);if(raw&&inputHash!==manifest.sources[input])throw Error('Region cache input mismatch: '+input);if(raw)inputs[input]=inputHash;
      const fingerprint=hash(JSON.stringify([codeHash,type==='sale'&&(manifest.schema!==3||reference)?membershipHash:null,manifest.schema===3?null:manifest.sources[type==='sale'?'data/daily/catalog.bin':'data/rental/catalog.bin'],inputHash,type]));
      const name=`${month}-${region}-${type}.bin`,path=prefix+name,target=join(directory,name),stamp=target+'.json';let proof,bytes;
      try{if(full)throw Error("Full verification requested");proof=JSON.parse(readFileSync(stamp));if(proof.fingerprint===fingerprint&&hash(readFileSync(target))===proof.sha256)bytes=readFileSync(target);}catch{}
      if(manifest.schema===3&&!reference){
        const dependencyPaths=type==='sale'?[0,1,2].flatMap(p=>reader.dependencies(`data/daily/${p}/${month}-state.bin`)):reader.dependencies(input);
        const rawDependencies=[...new Set(dependencyPaths.filter(p=>!p.endsWith('.json')||p.endsWith('.parts.json')))];
        for(const p of rawDependencies)reader.physical(p,false);
        const rawFingerprint=hash(JSON.stringify([codeHash,type,rawDependencies.map(p=>[p,manifest.sources[p]])]));
        let reusable=false;
        try{if(full)throw Error('Full verification requested');
          const old=JSON.parse(readFileSync(stamp));
          if(old.rawFingerprint===rawFingerprint&&typeof old.bindingsCompressed==='string'&&Number.isSafeInteger(old.groupCount)&&old.groupCount>=0){
            const blob=Buffer.from(old.bindingsCompressed,'base64');if(hash(blob)!==old.bindingsSha256)throw Error('Month bindings corrupted');const bindings=JSON.parse(gunzipSync(blob));if(!Array.isArray(bindings))throw Error('Month bindings invalid');
            const current=priceBindings(type==='sale'?'sale':'rental',type==='sale'?saleCatalog:rentalCatalog,payload,bindings.map(x=>x[0]),owners);
            const candidate=readFileSync(target);
            if(JSON.stringify(current)===JSON.stringify(bindings)&&hash(candidate)===old.sha256){bytes=candidate;reusable=true;stats.reusedMonths++;stats.reusedGroups+=old.groupCount;}
          }
        }catch{}
        if(!reusable){
        let combined=type==='sale'?saleMonths.get(month):rentalMonths.get(input);
        if(type!=='sale'&&!combined){combined=reader.read(input);stats.rentalStateParses++;rentalMonths.set(input,combined);}
        if(!combined){combined={opening:[],updates:[]};for(const province of [0,1,2]){const statePath=`data/daily/${province}/${month}-state.bin`,x=full?reader.read(statePath):reader.readMapState(statePath);combined.opening.push(...x.opening);combined.updates.push(...x.updates);}combined.updates.sort((a,b)=>a[1]-b[1]);saleMonths.clear();saleMonths.set(month,combined);}
        const groupFile=target+'.groups.bin',groupStamp=groupFile+'.json';let previous=[],invalidReceipt=false;
        try{if(full)throw Error('Full verification requested');const proof=JSON.parse(readFileSync(groupStamp)),blob=readFileSync(groupFile);if(proof.schema!==2||hash(blob)!==proof.sha256)throw Error('Group receipt corrupted');previous=JSON.parse(gunzipSync(blob));if(!Array.isArray(previous))throw Error('Group receipt invalid');}catch{if(!full&&existsSync(groupFile)){stats.invalidReceipts++;invalidReceipt=true;}}
        const result=type==='sale'?saleGroupFrames(ctx,saleCatalog,payload,combined,month,{previous,engine:codeHash,calculate:saleFrames,pack:packFrames,province:r}):rentalGroupFrames(ctx,rentalCatalog,combined,month,region,type,{previous,engine:codeHash,calculate:rentalFrames,pack:packFrames});
        stats.decoratedGroups+=result.stats.decoratedGroups;stats.computedGroups+=result.stats.computedGroups;stats.reusedGroups+=result.stats.reusedGroups;for(const key of Object.keys(stats.invalidationReasons))stats.invalidationReasons[key]+=result.stats.invalidationReasons[key];
        const next=gzipSync(JSON.stringify(result.frame),{level:6});
        let old;try{old=readFileSync(target);}catch{}
        if(old?.equals(next)){bytes=old;stats.reusedMonths++;}else{bytes=next;writeFileSync(target,bytes);stats.writtenMonths++;}
        if(result.stats.computedGroups||result.stats.decoratedGroups||!existsSync(groupFile)||invalidReceipt){const blob=gzipSync(JSON.stringify(result.records),{level:1});writeFileSync(groupFile,blob);writeFileSync(groupStamp,JSON.stringify({schema:2,sha256:hash(blob)}));}
        const bindings=priceBindings(type==='sale'?'sale':'rental',type==='sale'?saleCatalog:rentalCatalog,payload,result.references,owners);
        const bindingBytes=gzipSync(JSON.stringify(bindings),{level:6});
        writeFileSync(stamp,JSON.stringify({fingerprint,rawFingerprint,bindingsCompressed:bindingBytes.toString('base64'),bindingsSha256:hash(bindingBytes),groupCount:result.records.length,sha256:hash(bytes)}));
        }
      }else if(!bytes){const shard=reader.read(input);const packed=type==='sale'?saleFrames(ctx,saleCatalog,payload,shard,month):rentalFrames(ctx,rentalCatalog,shard,month,region,type);bytes=gzipSync(JSON.stringify(packed),{level:6});writeFileSync(target,bytes);writeFileSync(stamp,JSON.stringify({fingerprint,sha256:hash(bytes)}));stats.writtenMonths++;}else stats.reusedMonths++;
      if(type!=='sale'&&month===rental.months.at(-1)){let shard=rentalMonths.get(input);if(!shard){shard=reader.read(input);stats.rentalStateParses++;rentalMonths.set(input,shard);}for(const row of shard.updates){const day=ctx.NodoRental.iso(row[2]);if(day>rentalMaxDate)rentalMaxDate=day;}}
      if(bytes.length>25*1024*1024)throw Error('Region cache asset exceeds limit');sources[path]=hash(bytes);assets.push({path,source:target,sha256:sources[path],size:bytes.length});
    }
  }
  // Preserve the original public ordering, independently of internal work order.
  const typeRank={sale:0,jeonse:1,monthly:2},regionRank={'41':0,'11':1,'28':2};
  const order=a=>{const n=a.path.slice(prefix.length).match(/^(\d{4}-\d{2})-(41|11|28)-(sale|jeonse|monthly)\.bin$/);return [typeRank[n[3]],n[1],regionRank[n[2]]];};
  assets.sort((a,b)=>{const x=order(a),y=order(b);return x[0]-y[0]||x[1].localeCompare(y[1])||x[2]-y[2];});
  // Keep monthly assets for older clients; bundle their verified frames without changing state semantics.
  const groups=new Map(),quarterSources={};
  for(const asset of assets){const name=asset.path.slice(prefix.length),month=name.slice(0,7),quarter=month.slice(0,4)+'-Q'+Math.ceil(Number(month.slice(5))/3),path=prefix+quarter+name.slice(7);
    if(!groups.has(path))groups.set(path,[]);groups.get(path).push([month,asset]);
  }
  for(const [path,members]of groups){const frames={};
    for(const [month,asset]of members){const bytes=readFileSync(asset.source);if(hash(bytes)!==asset.sha256)throw Error('Region month changed during packing: '+asset.path);frames[month]=bytes;}
    const target=join(directory,path.slice(prefix.length)),stamp=target+'.json',dependencyHash=hash(JSON.stringify([codeHash,members.map(([month,a])=>[month,a.sha256])]));let bytes;
    try{if(full)throw Error('Full verification requested');const proof=JSON.parse(readFileSync(stamp)),old=readFileSync(target);if(proof.dependencyHash===dependencyHash&&proof.sha256===hash(old)){bytes=old;stats.reusedQuarters++;}}catch{}
    if(!bytes){for(const month of Object.keys(frames))frames[month]=JSON.parse(gunzipSync(frames[month]));bytes=gzipSync(JSON.stringify({schema:1,months:frames}),{level:6});if(bytes.length>25*1024*1024)throw Error('Region quarter exceeds limit');let old;try{old=readFileSync(target);}catch{}if(old?.equals(bytes))stats.reusedQuarters++;else{writeFileSync(target,bytes);stats.writtenQuarters++;}writeFileSync(stamp,JSON.stringify({dependencyHash,sha256:hash(bytes)}));}
    quarterSources[path]=hash(bytes);assets.push({path,source:target,sha256:quarterSources[path],size:bytes.length});
  }
  const packedOnly=sale.schema===3&&rental.schema===3;if(packedOnly){for(let i=assets.length-1;i>=0;i--)if(sources[assets[i].path])assets.splice(i,1);for(const p of Object.keys(sources))delete sources[p];}
  for(const[p,bytes]of snapshots)if(!read(p).equals(bytes))throw Error('Region manifest changed during build: '+p);if(hash(Buffer.concat(enginePaths.map(read)))!==codeHash)throw Error('Region calculation code changed during build');saleReader.recheck?.();rentReader.recheck?.();stats.housingDecodeCache={sale:{...saleDecodeCache.stats},rental:{...rentalDecodeCache.stats}};Object.assign(inputs,saleReader.inputs,rentReader.inputs);assets.push({path:prefix+'index.json',bytes:Buffer.from(JSON.stringify({schema:packedOnly?2:1,versions:{sale:sale.version,rental:rental.version,map:payload.meta.sourceVersion},rentalMaxDate,inputs,sources,quarterSources}))});return assets;
}
