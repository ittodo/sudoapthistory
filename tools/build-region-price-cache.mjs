import {privateCache} from './private-cache.mjs';
import {regionalReader} from './regional-data.mjs';
import {createHousingDecodeCache} from './housing-regional-reader.mjs';
import {saleGroupFrames,rentalGroupFrames,priceBindings} from './region-price-groups.mjs';
import {codeDependencyEngine} from './code-dependencies.mjs';
import {encodeRegionQuarter,FORMAT} from './region-price-quarter.mjs';
import {readFileSync,writeFileSync,existsSync,mkdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import vm from 'node:vm';

const hash=b=>createHash('sha256').update(b).digest('hex'),prefix='data/map/price-cache/';
const models=['map-pricing','daily-model','rental-model','rental-map-model'];
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
  const original=new Map(payload.d.flatMap(c=>[[c.id,c],...(c.memberSources||[]).map(s=>[s.id,c])])),group=ctx.NodoMapPricing.createPriceGroups(catalog,original,ctx.NodoDailyModel),cursor=ctx.NodoDailyModel.priceCursor(shard);
  const days=[month+'-00',...new Set(shard.updates.map(r=>ctx.NodoDailyModel.iso(r[1])))].sort();
  return packFrames(days,day=>{
    const f=cursor.seek(Number(day.replaceAll('-',''))),result=group.update({values:[f.values],changes:f.events,reset:f.reset},{});
    const matches=result.complexes.map(c=>ctx.NodoMapPricing.match(c,{})).filter(Boolean);
    return {regions:[...ctx.NodoMapPricing.regionGroups(matches)].map(([id,members])=>{const s=ctx.NodoMapPricing.clusterTotals(members);return [id,[s.count,s.pricedCount,s.sum]];}),meta:{complexCount:matches.length,count:matches.length}};
  });
}
export function regionPriceAssets(root,{months,stats={},reference=false}={}){
  if(!existsSync(join(root,'data/map/index.json'))||!existsSync(join(root,'data/daily/index.json'))||!existsSync(join(root,'data/rental/index.json')))return [];
  const started=performance.now(),ctx=regionModels(root),assets=[],sources={},inputs={},directory=join(root,reference?'cloudflare/dist/region-price-reference-v1':'cloudflare/dist/region-price-cache-v2');
  const cache=privateCache(root,reference?'cloudflare/dist/region-price-reference-v1':'cloudflare/dist/region-price-cache-v2');
  const timings={},measure=(name,fn)=>{const start=performance.now();try{return fn();}finally{timings[name]=(timings[name]||0)+(performance.now()-start)/1000;}};
  const readCache=(file,kind)=>{stats[kind]=(stats[kind]||0)+1;return measure('cacheRead',()=>cache.read(file));};
  const writeCache=(file,bytes)=>measure('cacheWrite',()=>cache.write(file,bytes));
  const materialize=(file,bytes)=>measure('materialize',()=>cache.materialize(file,bytes));
  try{
    Object.assign(stats,{computedGroups:0,reusedGroups:0,decoratedGroups:0,rentalStateParses:0,saleStateParses:0,reusedMonths:0,writtenMonths:0,reusedQuarters:0,writtenQuarters:0,invalidReceipts:0,semanticReusedMonths:0,assembledMonths:0,bindingsDecoded:0,monthPayloadReads:0,quarterPayloadReads:0,groupPayloadReads:0,receiptReads:0,bindingsReads:0,repairedMonths:0,latestRowsReads:0,verifiedInputFiles:0,invalidationReasons:{missing:0,inputs:0,engine:0,corrupt:0}});
    const full=process.env.NODO_FULL_VERIFY==='1',saleMonths=new Map(),rentalMonths=new Map(),semanticStates=new Map();
    for(const p of [join(root,'cloudflare'),join(root,'cloudflare/dist'),directory])if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('Symlink region cache output');mkdirSync(directory,{recursive:true});
    const read=p=>readFileSync(join(root,p)),snapshots=new Map(['data/map/index.json','data/daily/index.json','data/rental/index.json'].map(p=>[p,read(p)]));
    const payload=JSON.parse(snapshots.get('data/map/index.json')),sale=JSON.parse(snapshots.get('data/daily/index.json')),rental=JSON.parse(snapshots.get('data/rental/index.json'));
    const saleDecodeCache=createHousingDecodeCache(),rentalDecodeCache=createHousingDecodeCache();
    const saleReader=regionalReader(root,'daily',{verifyOnce:!reference&&!full,decodeCache:saleDecodeCache}),rentReader=regionalReader(root,'rental',{verifyOnce:!reference&&!full,decodeCache:rentalDecodeCache}),saleCatalog=saleReader.catalog,rentalCatalog=rentReader.catalog.complexes;
    sale.schema??=1;rental.schema??=1;ctx.NodoRental.normalizeDistricts(rentalCatalog);
    const packedOnly=sale.schema===3&&rental.schema===3;
    const enginePaths=['tools/build-region-price-cache.mjs','tools/private-cache.mjs','tools/region-price-groups.mjs','tools/regional-data.mjs','tools/regional-reader.mjs','js/regional-data.js',...(sale.schema===3?['tools/housing-regional-reader.mjs','tools/housing-map-quarter.mjs','js/housing-map-quarter.mjs','js/housing-quarter.mjs','js/housing-facts.mjs','js/housing-state-timeline.mjs','js/housing-state-bundle.mjs','js/housing-validation.mjs','js/housing-partition.mjs','js/generated/housing-columns.mjs']:[]),...models.map(n=>'js/'+n+'.js')],codeHash=hash(Buffer.concat(enginePaths.map(read)));
    const packingEngine=()=>codeDependencyEngine(root,{roots:['tools/region-price-quarter.mjs']}),packingHash=packingEngine();
    const mapHash=hash(snapshots.get('data/map/index.json')),membershipHash=hash(JSON.stringify(payload.d.map(c=>[c.id,c.r,c.admin,c.memberSources?.map(s=>s.id)])));inputs['data/map/index.json']=mapHash;
    const owners=new Map(payload.d.flatMap(c=>[[c.id,c],...(c.memberSources||[]).map(x=>[x.id,c])]));
    const metadataHash=(reader,kind)=>hash(JSON.stringify([kind==='sale'?membershipHash:null,[...reader.table.regions].map(([code,r])=>[code,reader.manifest.sources[r.entry.identities],reader.manifest.sources[r.entry.metadata]])]));
    const metadata={sale:sale.schema===3?metadataHash(saleReader,'sale'):null,rental:rental.schema===3?metadataHash(rentReader,'rental'):null};
    const checked=new Map(),check=(reader,paths)=>measure('inputVerification',()=>{if(!checked.has(reader))checked.set(reader,new Set());const seen=checked.get(reader);for(const p of paths)if(!seen.has(p)){reader.physical(p,false);seen.add(p);stats.verifiedInputFiles++;}});
    const bindingValues={sale:new Map(),rental:new Map()};
    const bindingsFor=(kind,refs)=>refs.map(key=>{const memo=bindingValues[kind];if(!memo.has(key))memo.set(key,priceBindings(kind,kind==='sale'?saleCatalog:rentalCatalog,payload,[key],owners)[0]);return memo.get(key);});
    const validProof=p=>p?.schema===3&&p.engine===codeHash&&/^[a-f0-9]{64}$/.test(p.sha256)&&Number.isSafeInteger(p.bytes)&&p.bytes>=0&&Number.isSafeInteger(p.groupCount)&&p.groupCount>=0&&/^\d{4}-\d{2}-\d{2}$/.test(p.maxDate);
    function bindingsMatch(proof,kind,target,province){
      if(proof.metadata===metadata[kind])return true;
      try{
        const blob=readCache(target+'.bindings.bin','bindingsReads');
        return measure('bindings',()=>{
          if(hash(blob)!==proof.bindingsSha256)return false;stats.bindingsDecoded++;const bindings=JSON.parse(gunzipSync(blob));if(!Array.isArray(bindings))return false;
          const current=bindingsFor(kind,bindings.map(x=>x[0]));
          return bindings.every((old,i)=>{
            if(JSON.stringify(old)===JSON.stringify(current[i]))return true;
            if(kind!=='sale')return false;
            // Keep both old/new source and owner provinces: moving a group can
            // change the receiving province or its otherwise empty event days.
            const affects=value=>{const row=JSON.parse(value);return row[3]===province||row[4]?.[1]===province;};
            return !affects(old[1])&&!affects(current[i][1]);
          });
        });
      }catch{return false;}
    }
    function state(spec){
      const {type,month,input}=spec;
      if(type==='sale'){
        if(!saleMonths.has(month)){saleMonths.clear();semanticStates.clear();const combined={opening:[],updates:[]};
          measure('stateDecode',()=>{for(const province of [0,1,2]){const p='data/daily/'+province+'/'+month+'-state.bin',x=full?saleReader.read(p):saleReader.readMapState(p);combined.opening.push(...x.opening);combined.updates.push(...x.updates);}combined.updates.sort((a,b)=>a[1]-b[1]);});
          stats.saleStateParses++;saleMonths.set(month,combined);
        }return saleMonths.get(month);
      }
      if(!rentalMonths.has(input)){if(rentalMonths.size&&![...rentalMonths.keys()][0].includes(month)){rentalMonths.clear();semanticStates.clear();}const value=measure('stateDecode',()=>rentReader.read(input));stats.rentalStateParses++;rentalMonths.set(input,value);}
      return rentalMonths.get(input);
    }
    function semanticState(spec,combined){
      const key=spec.type+'|'+spec.month+'|'+spec.region;
      if(!semanticStates.has(key))semanticStates.set(key,measure('stateFingerprint',()=>{
        if(spec.type==='sale'){
          const source=row=>saleCatalog.complexes[saleCatalog.areas[row[0]][0]],belongs=row=>(owners.get(source(row).id)?.r??source(row).r)===spec.r;
          return hash(JSON.stringify([combined.opening.filter(belongs),combined.updates.filter(belongs),[...new Set(combined.updates.filter(row=>source(row).r===spec.r).map(row=>row[1]))].sort((a,b)=>a-b)]));
        }
        const selected=row=>(row[4]>0)===(spec.type==='monthly');
        return hash(JSON.stringify([combined.opening.filter(selected),combined.updates.filter(selected),[...new Set(combined.updates.map(row=>row[2]))].sort((a,b)=>a-b)]));
      }));
      return semanticStates.get(key);
    }
    const maxDate=(rows,index,initial)=>rows.reduce((date,row)=>{const d=ctx.NodoRental.iso(row[index]);return d>date?d:date;},initial);
    let rentalMaxDate=rental.months.at(-1)+'-01';
    const latestPaths=['41','11','28'].map(region=>'data/rental/months/'+rental.months.at(-1)+'-'+region+'.bin');
    if(rental.schema===3&&!reference){
      const paths=[...new Set(latestPaths.flatMap(p=>rentReader.dependencies(p,true)))];check(rentReader,paths);
      const key=hash(JSON.stringify([codeHash,rental.months.at(-1),paths.map(p=>[p,rental.sources[p]])])),stamp=join(directory,'latest-rental.json');let old;
      try{if(!full)old=JSON.parse(readCache(stamp,'receiptReads'));}catch{}
      if(old?.key===key&&/^\d{4}-\d{2}-\d{2}$/.test(old.date))rentalMaxDate=old.date;
      else{for(const p of latestPaths){stats.latestRowsReads++;rentalMaxDate=maxDate(measure('stateDecode',()=>rentReader.read(p).rows),2,rentalMaxDate);}writeCache(stamp,JSON.stringify({key,date:rentalMaxDate}));}
    }else for(const p of latestPaths)if(rental.schema>=2||rental.sources[p]){stats.latestRowsReads++;rentalMaxDate=maxDate(measure('stateDecode',()=>rentReader.read(p).rows),2,rentalMaxDate);}
    timings.setup=(performance.now()-started)/1000-(timings.stateDecode||0)-(timings.inputVerification||0)-(timings.cacheRead||0)-(timings.cacheWrite||0);

    const prepared=new Map(),specs=new Map();
    function monthAsset(spec,repair=false){
      const {type,month,r,region,input}=spec,kind=type==='sale'?'sale':'rental',manifest=type==='sale'?sale:rental,reader=type==='sale'?saleReader:rentReader;
      const name=month+'-'+region+'-'+type+'.bin',path=prefix+name,target=join(directory,name),stamp=target+'.json';
      let proof,bytes,fast=false,semantic=false,groupCount=0;
      try{if(!full)proof=JSON.parse(readCache(stamp,'receiptReads'));}catch{}
      if(manifest.schema===3&&!reference){
        const dependencyPaths=type==='sale'?[0,1,2].flatMap(p=>reader.dependencies('data/daily/'+p+'/'+month+'-state.bin')):reader.dependencies(input);
        const rawDependencies=[...new Set(dependencyPaths.filter(p=>!p.endsWith('.json')||p.endsWith('.parts.json')))];check(reader,rawDependencies);
        // Month selectors and state sections are inputs even if file hashes do not change.
        const routes=[...reader.table.regions].filter(([,v])=>type==='sale'||v.metadata.complexes.some(c=>c.r===r)).map(([code])=>[code,manifest.regional.quarters?.[code]?.[month]??null,manifest.regional.states?.[code]?.[month]??null]);
        const rawFingerprint=measure('inputFingerprint',()=>hash(JSON.stringify([codeHash,type,routes,rawDependencies.map(p=>[p,manifest.sources[p],manifest.regional.stateSections?.[p]??null])])));
        let bound=!full&&!repair&&validProof(proof)&&bindingsMatch(proof,kind,target,r);
        // Mixed legacy sources still publish monthly files, so those bytes
        // must be checked here even when the quarter can be reused.
        if(bound&&!packedOnly)try{bytes=readCache(target,'monthPayloadReads');if(hash(bytes)!==proof.sha256)throw Error('Region month cache changed');}catch{bound=false;bytes=undefined;}
        let combined,stateHash;
        if(bound&&proof.rawFingerprint===rawFingerprint)fast=true;
        else{
          combined=state(spec);stateHash=semanticState(spec,combined);
          if(bound&&proof.stateHash===stateHash){fast=true;semantic=true;stats.semanticReusedMonths++;}
        }
        if(fast){
          groupCount=proof.groupCount;stats.reusedGroups+=groupCount;stats.reusedMonths++;
          if(proof.rawFingerprint!==rawFingerprint||proof.metadata!==metadata[kind]){proof={...proof,rawFingerprint,metadata:metadata[kind]};writeCache(stamp,JSON.stringify(proof));}
        }else{
          combined??=state(spec);stateHash??=semanticState(spec,combined);
          const groupFile=target+'.groups.bin',groupStamp=groupFile+'.json';let previous=[],invalidReceipt=false;
          try{if(full)throw Error('Full verification requested');const receipt=JSON.parse(readCache(groupStamp,'receiptReads')),blob=readCache(groupFile,'groupPayloadReads');if(receipt.schema!==2||hash(blob)!==receipt.sha256)throw Error('Group receipt corrupted');previous=measure('groupDecode',()=>JSON.parse(gunzipSync(blob)));if(!Array.isArray(previous))throw Error('Group receipt invalid');}catch{if(!full&&cache.exists(groupFile)){stats.invalidReceipts++;invalidReceipt=true;}}
          const result=measure('groupCalculationAndAssembly',()=>type==='sale'?saleGroupFrames(ctx,saleCatalog,payload,combined,month,{previous,engine:codeHash,calculate:saleFrames,pack:packFrames,province:r}):rentalGroupFrames(ctx,rentalCatalog,combined,month,region,type,{previous,engine:codeHash,calculate:rentalFrames,pack:packFrames}));
          stats.assembledMonths++;stats.decoratedGroups+=result.stats.decoratedGroups;stats.computedGroups+=result.stats.computedGroups;stats.reusedGroups+=result.stats.reusedGroups;for(const key of Object.keys(stats.invalidationReasons))stats.invalidationReasons[key]+=result.stats.invalidationReasons[key];
          bytes=measure('monthEncoding',()=>gzipSync(JSON.stringify(result.frame),{level:6}));const digest=hash(bytes);
          if(digest===proof?.sha256)stats.reusedMonths++;else stats.writtenMonths++;writeCache(target,bytes);
          if(result.stats.computedGroups||result.stats.decoratedGroups||!cache.exists(groupFile)||invalidReceipt){const blob=measure('groupEncoding',()=>gzipSync(JSON.stringify(result.records),{level:1}));writeCache(groupFile,blob);writeCache(groupStamp,JSON.stringify({schema:2,sha256:hash(blob)}));}
          const blob=measure('bindings',()=>gzipSync(JSON.stringify(bindingsFor(kind,result.references)),{level:6}));writeCache(target+'.bindings.bin',blob);
          proof={schema:3,engine:codeHash,rawFingerprint,stateHash,metadata:metadata[kind],bindingsSha256:hash(blob),groupCount:result.records.length,sha256:digest,bytes:bytes.length,maxDate:type==='sale'?month+'-01':maxDate(combined.updates,2,month+'-01')};writeCache(stamp,JSON.stringify(proof));
        }
      }else{
        const raw=manifest.schema===1?read(input):null,inputHash=manifest.schema>=2?reader.fingerprint(input,true):hash(raw);if(raw&&inputHash!==manifest.sources[input])throw Error('Region cache input mismatch: '+input);if(raw)inputs[input]=inputHash;
        const fingerprint=hash(JSON.stringify([codeHash,type==='sale'&&(manifest.schema!==3||reference)?membershipHash:null,manifest.schema===3?null:manifest.sources[type==='sale'?'data/daily/catalog.bin':'data/rental/catalog.bin'],inputHash,type]));
        try{if(!full&&proof?.fingerprint===fingerprint){const candidate=readCache(target,'monthPayloadReads');if(hash(candidate)===proof.sha256)bytes=candidate;}}catch{}
        if(!bytes){const shard=measure('stateDecode',()=>reader.read(input)),frame=type==='sale'?saleFrames(ctx,saleCatalog,payload,shard,month):rentalFrames(ctx,rentalCatalog,shard,month,region,type);bytes=gzipSync(JSON.stringify(frame),{level:6});proof={fingerprint,sha256:hash(bytes)};writeCache(target,bytes);writeCache(stamp,JSON.stringify(proof));stats.writtenMonths++;}else stats.reusedMonths++;
        if(type!=='sale'&&month===rental.months.at(-1))rentalMaxDate=maxDate(reader.read(input).updates,2,rentalMaxDate);
      }
      if(type!=='sale'&&month===rental.months.at(-1)&&proof.maxDate>rentalMaxDate)rentalMaxDate=proof.maxDate;
      const size=bytes?.length??proof.bytes;if(size>25*1024*1024)throw Error('Region cache asset exceeds limit');
      if(!packedOnly){bytes??=readCache(target,'monthPayloadReads');materialize(target,bytes);}
      const asset={path,source:target,sha256:proof.sha256,size};sources[path]=asset.sha256;
      prepared.set(path,{fast,semantic,groupCount});specs.set(path,spec);return asset;
    }
    const tasks=reference?['sale','jeonse','monthly'].flatMap(type=>(type==='sale'?sale:rental).months.map(month=>({type,month}))):[...sale.months.map(month=>({type:'sale',month})),...rental.months.flatMap(month=>['jeonse','monthly'].map(type=>({type,month})))];
    for(const task of tasks.filter(t=>!months||months.includes(t.month)))for(const[r,region]of ['41','11','28'].entries()){
      const manifest=task.type==='sale'?sale:rental,input=task.type==='sale'?'data/daily/'+r+'/'+task.month+'-state.bin':'data/rental/months/'+task.month+'-'+region+'-state.bin';
      if(manifest.schema===1&&!manifest.sources[input])continue;assets.push(monthAsset({...task,r,region,input}));
    }
    const typeRank={sale:0,jeonse:1,monthly:2},regionRank={'41':0,'11':1,'28':2};
    const order=a=>{const n=a.path.slice(prefix.length).match(/^(\d{4}-\d{2})-(41|11|28)-(sale|jeonse|monthly)\.bin$/);return [typeRank[n[3]],n[1],regionRank[n[2]]];};
    assets.sort((a,b)=>{const x=order(a),y=order(b);return x[0]-y[0]||x[1].localeCompare(y[1])||x[2]-y[2];});
    const groups=new Map(),quarterSources={};
    for(const asset of assets){const name=asset.path.slice(prefix.length),month=name.slice(0,7),quarter=month.slice(0,4)+'-Q'+Math.ceil(Number(month.slice(5))/3),path=prefix+quarter+name.slice(7);if(!groups.has(path))groups.set(path,[]);groups.get(path).push([month,asset]);}
    for(const[path,members]of groups){
      const target=join(directory,path.slice(prefix.length)),stamp=target+'.json',dependencyHash=()=>hash(JSON.stringify([FORMAT,packingHash,members.map(([month,a])=>[month,a.sha256])]));
      let proof,bytes;
      try{if(!full){proof=JSON.parse(readCache(stamp,'receiptReads'));if(proof.dependencyHash===dependencyHash()){const candidate=readCache(target,'quarterPayloadReads');if(hash(candidate)===proof.sha256){bytes=candidate;stats.reusedQuarters++;}}}}catch{}
      if(!bytes){
        const frames={};
        for(const[month,asset]of members){
          let raw;
          try{raw=readCache(asset.source,'monthPayloadReads');if(hash(raw)!==asset.sha256)throw Error('Region month cache changed');}
          catch(error){
            const prior=prepared.get(asset.path);if(!prior.fast)throw error;
            stats.repairedMonths++;stats.reusedMonths--;stats.reusedGroups-=prior.groupCount;if(prior.semantic)stats.semanticReusedMonths--;
            Object.assign(asset,monthAsset(specs.get(asset.path),true));raw=readCache(asset.source,'monthPayloadReads');if(hash(raw)!==asset.sha256)throw Error('Repaired region month changed');
          }
          frames[month]=measure('quarterAssembly',()=>JSON.parse(gunzipSync(raw)));
        }
        bytes=measure('quarterAssembly',()=>encodeRegionQuarter(frames));if(bytes.length>25*1024*1024)throw Error('Region quarter exceeds limit');
        if(proof?.sha256===hash(bytes))stats.reusedQuarters++;else stats.writtenQuarters++;writeCache(target,bytes);writeCache(stamp,JSON.stringify({dependencyHash:dependencyHash(),sha256:hash(bytes)}));
      }
      materialize(target,bytes);quarterSources[path]=hash(bytes);assets.push({path,source:target,sha256:quarterSources[path],size:bytes.length});
    }
    if(packedOnly){for(let i=assets.length-1;i>=0;i--)if(sources[assets[i].path])assets.splice(i,1);for(const p of Object.keys(sources))delete sources[p];}
    measure('finalInputCheck',()=>{for(const[p,bytes]of snapshots)if(!read(p).equals(bytes))throw Error('Region manifest changed during build: '+p);if(hash(Buffer.concat(enginePaths.map(read)))!==codeHash)throw Error('Region calculation code changed during build');if(packingEngine()!==packingHash)throw Error('Region packing code changed during build');saleReader.recheck?.();rentReader.recheck?.();});
    stats.housingDecodeCache={sale:{...saleDecodeCache.stats},rental:{...rentalDecodeCache.stats}};Object.assign(inputs,saleReader.inputs,rentReader.inputs);assets.push({path:prefix+'index.json',bytes:Buffer.from(JSON.stringify({schema:packedOnly?2:1,format:FORMAT,versions:{sale:sale.version,rental:rental.version,map:payload.meta.sourceVersion},rentalMaxDate,inputs,sources,quarterSources}))});return assets;
  }finally{cache.close();stats.phaseTimings={...timings,total:(performance.now()-started)/1000};}
}
