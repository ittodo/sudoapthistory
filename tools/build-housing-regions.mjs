import{quarterMemo}from'./housing-quarter-cache.mjs';
import{yearMemo}from'./housing-year-cache.mjs';
import{packedMemo,identityDependencies}from'./housing-packing-cache.mjs';
import{partitionHousing}from'./housing-partition.mjs';import{partitionDescriptor,joinPartition}from'../js/housing-partition.mjs';
import{readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,lstatSync,renameSync}from'node:fs';
import{resolve,dirname,join,sep}from'node:path';import{createHash}from'node:crypto';import{gzipSync,gunzipSync}from'node:zlib';import{pathToFileURL}from'node:url';import assert from'node:assert/strict';
import{regionalReader}from'./regional-reader.mjs';import{packQuarter,encodeQuarter,decodeQuarter}from'../js/housing-quarter.mjs';import{packStateTimeline,encodeStateFile,decodeStateFile}from'../js/housing-state-timeline.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function buildHousingRegions(root,output,codec,{codes=null,readers=null,previousRoot=null,cacheDir=null,generationSession=null}={}){
 root=realpathSync(root);output=resolve(output);if(root===output||output.startsWith(root+sep)||root.startsWith(output+sep))throw Error('Isolated output required');
 mkdirSync(output,{recursive:true});if(realpathSync(output).toLowerCase()!==output.toLowerCase())throw Error('Output link not allowed');
 const daily=readers?.daily??regionalReader(root,'daily'),rental=readers?.rental??regionalReader(root,'rental');if(daily.manifest.schema!==2||rental.manifest.schema!==2)throw Error('Verified schema 2 input required for initial migration');
 const engine=hash(['./build-housing-regions.mjs','./build-housing-from-native.mjs','./housing-packing-cache.mjs','./housing-year-cache.mjs','./housing-quarter-cache.mjs','./housing-native-inputs.mjs','./housing-native-adapter.mjs','./regional-reader.mjs','./housing-regional-reader.mjs','../js/regional-data.js','../js/housing-validation.mjs','../js/housing-quarter.mjs','../js/housing-facts.mjs','../js/housing-state-timeline.mjs','../js/housing-partition.mjs','./housing-partition.mjs','../js/generated/housing-columns.mjs'].map(p=>hash(readFileSync(new URL(p,import.meta.url)))).join('|'));
 function packed(code,scope,kind,value,identity,path){const previous=boundaries(path,kind),key=[engine,code,scope,kind,value,identityDependencies(identity,value,kind),previous?.leaves.map(x=>x.prefix)||null];
  return packedMemo(cacheDir,key,emit=>partitionHousing({code,scope,kind,months:value,identity,codec,path,emit,previous}), (result,files)=>{if(result.path!==path&&result.path!==path.slice(0,-4)+'.parts.json')throw Error('Cache output scope mismatch');const allowed=result.path.endsWith('.parts.json')?[result.path,...partitionDescriptor(JSON.parse(files.get(result.path)),result.path,Object.fromEntries([...files].map(([p,b])=>[p,hash(b)])))]:[path];if(files.size!==allowed.length||[...files].some(([p,b])=>!allowed.includes(p)||b.length>20*1024*1024))throw Error('Cache output inventory mismatch');const raw=p=>new Uint8Array(gunzipSync(files.get(p)));let reader;
   if(result.path.endsWith('.parts.json')){const desc=JSON.parse(files.get(result.path)),sources=Object.fromEntries([...files].map(([p,b])=>[p,hash(b)]));partitionDescriptor(desc,result.path,sources);reader=joinPartition(desc,desc.leaves.map(x=>raw(x.path)),raw(desc.order),identity,codec);}else reader=kind==='quarter'?decodeQuarter(raw(result.path),identity,codec,{lawd:code,quarter:scope}):decodeStateFile(raw(result.path),codec,{lawd:code,kind});
   for(const m of Object.keys(value)){if(kind==='quarter'){for(const k of ['daily','rental'])for(const field of ['rows','updates'])assert.deepEqual(reader.month(m)[k][field],value[m][k][field]);}else assert.deepEqual(reader.month(m),value[m]);}
  },emit,{reuseValidation:true});
 }
 const priorBytes=previousRoot?readFileSync(join(previousRoot,'data/daily/index.json')):null,prior=priorBytes?JSON.parse(priorBytes):null;
 const priorRentalBytes=prior?.schema===3?readFileSync(join(previousRoot,'data/rental/index.json')):null,priorRental=priorRentalBytes?JSON.parse(priorRentalBytes):null;
 function boundaries(path,kind){if(!prior||prior.schema!==3)return null;const m=kind==='rental'?priorRental:prior,p=path.slice(0,-4)+'.parts.json';if(!m.sources[p])return null;const b=readFileSync(join(previousRoot,p));if(hash(b)!==m.sources[p])throw Error('Previous partition changed');const v=JSON.parse(b);partitionDescriptor(v,p,m.sources);return v;}
 const inputs={},sources={},quarters={},states={daily:{},rental:{}},regions={},metrics=[];
 const emit=(path,bytes)=>{if(!path.startsWith('data/')||path.includes('..'))throw Error('Unsafe output');const target=join(output,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);sources[path]=hash(bytes);return bytes.length;};
 const json=(path,value)=>emit(path,Buffer.from(JSON.stringify(value)));
 const selected=codes??[...daily.table.regions.keys()].sort();
 for(const code of selected){
  const entry=daily.table.regions.get(code);if(!entry)throw Error('Unknown region');const identity=structuredClone(entry.identity);
  const layout={};if(prior?.schema===3)for(const kind of ['quarter','daily','rental']){const m=kind==='rental'?priorRental:prior,paths=kind==='quarter'?m.regional.quarters?.[code]:m.regional.states?.[code];for(const path of new Set(Object.values(paths||{}).filter(Boolean))){if(path.endsWith('.parts.json'))layout[path]=boundaries(path.slice(0,-11)+'.bin',kind)?.leaves.map(x=>x.prefix);}}
  const regionInput=readers?.regionFingerprint?.(code),scopeKey=regionInput?hash(JSON.stringify([engine,code,regionInput,identity,layout])):null;
  const batchIdentity={[code]:identity},batchKey=[engine,code,regionInput,identity,layout];
  const batchRegion=readers?.regionFingerprint?generationSession?.load('region/'+code,batchKey,batchIdentity,p=>p.startsWith('data/daily/regions/'+code+'/')&&!p.endsWith('metadata.json'),emit):null;
  if(batchRegion){quarters[code]=batchRegion.quarters;states.daily[code]=batchRegion.states.daily;states.rental[code]=batchRegion.states.rental;json('data/daily/regions/'+code+'/metadata.json',entry.metadata);regions[code]={identities:'data/daily/regions/'+code+'/identities.json',metadata:'data/daily/regions/'+code+'/metadata.json'};metrics.push({...batchRegion.metrics,regionReused:true,monthsDecoded:0,yearsReused:0,quartersReused:0,validationReused:0,batchReused:true});continue;}
  const scopeCache=cacheDir&&scopeKey?join(resolve(cacheDir),'native-regions',scopeKey):null;
  if(scopeCache&&process.env.NODO_FULL_VERIFY!=='1'&&existsSync(join(scopeCache,'receipt.json'))){
   if(realpathSync(scopeCache).toLowerCase()!==scopeCache.toLowerCase()||lstatSync(join(scopeCache,'receipt.json')).isSymbolicLink())throw Error('Region packing receipt link');
   const bytes=readFileSync(join(scopeCache,'receipt.json')),stored=JSON.parse(bytes),body=stored.body;if(stored.sha256!==hash(JSON.stringify(body))||body.code!==code||body.key!==scopeKey)throw Error('Region packing receipt mismatch');
   const assets=[];for(const[path,record]of Object.entries(body.files)){if(!path.startsWith(`data/daily/regions/${code}/`)||path.includes('..')||!/^\d+\.bin$/.test(record.file)||path.endsWith('metadata.json'))throw Error('Region packing cache path');const file=join(scopeCache,record.file);if(lstatSync(file).isSymbolicLink()||lstatSync(file).size>25*1024*1024||realpathSync(file).toLowerCase()!==file.toLowerCase())throw Error('Region packing cache link');const b=readFileSync(file);if(hash(b)!==record.sha256)throw Error('Region packing cache bytes changed');assets.push([path,b]);}
   for(const path of [...Object.values(body.quarters),...Object.values(body.states.daily),...Object.values(body.states.rental)].filter(Boolean))if(!body.files[path])throw Error('Region packing cache asset missing');
   if(!body.files[`data/daily/regions/${code}/identities.json`])throw Error('Region packing cache identity missing');
   for(const[path,b]of assets)emit(path,b);quarters[code]=body.quarters;states.daily[code]=body.states.daily;states.rental[code]=body.states.rental;const metaPath=`data/daily/regions/${code}/metadata.json`;json(metaPath,entry.metadata);regions[code]={identities:`data/daily/regions/${code}/identities.json`,metadata:metaPath};if(readers?.regionFingerprint)generationSession?.save('region/'+code,batchKey,batchIdentity,{quarters:body.quarters,states:body.states,metrics:body.metrics},Object.keys(body.files));metrics.push({...body.metrics,validationReused:0,yearsReused:0,quartersReused:0,monthsDecoded:0,regionReused:true});process.stderr.write(code+' reused verified region packaging\n');continue;
  }

  const months=[...new Set([...Object.keys(daily.manifest.regional.bases?.[code]||{}),...Object.keys(daily.manifest.regional.overlays?.[code]||{}),...Object.keys(rental.manifest.regional.bases?.[code]||{}),...Object.keys(rental.manifest.regional.overlays?.[code]||{})])].sort();
  const quarterNames=[...new Set(months.map(m=>m.slice(0,4)+'-Q'+Math.ceil(Number(m.slice(5))/3)))];quarters[code]={};states.daily[code]={};states.rental[code]={};
  let stateYear=null,opening={daily:{},rental:{}},nrows=0,newBytes=0,files=0;
  let reused=0,validationReused=0,yearsReused=0,quartersReused=0,monthsDecoded=0;
  function flushStates(){if(stateYear===null)return;for(const kind of ['daily','rental']){if(Object.values(opening[kind]).every(rows=>rows.length===0)){for(const month of Object.keys(opening[kind]))states[kind][code][month]=null;continue;}const path=`data/daily/regions/${code}/states/${kind}/${stateYear}.bin`,part=packed(code,stateYear,kind,opening[kind],identity,path);newBytes+=part.bytes;files+=part.files;if(part.reused)reused++;if(part.validationReused)validationReused++;for(const month of Object.keys(opening[kind]))states[kind][code][month]=part.path;}opening={daily:{},rental:{}};}

  for(const year of [...new Set(quarterNames.map(q=>q.slice(0,4)))]){
   const ym=months.filter(m=>m.startsWith(year+'-')),yearLayout=Object.fromEntries(Object.entries(layout).filter(([p])=>p.includes('/'+year)));
   const periodInput=readers?.periodFingerprint?.(code,ym),batchYearKey=[engine,code,year,ym,periodInput,yearLayout];
   const batchYear=readers?.periodFingerprint?generationSession?.load('year/'+code+'/'+year,batchYearKey,{[code]:identity},p=>p.startsWith('data/daily/regions/'+code+'/')&&(p.includes('/quarters/'+year+'-Q')||p.includes('/states/daily/'+year)||p.includes('/states/rental/'+year)),emit):null;
   if(batchYear){Object.assign(quarters[code],batchYear.quarters);for(const kind of ['daily','rental'])Object.assign(states[kind][code],batchYear.states[kind]);nrows+=batchYear.metrics.rows;newBytes+=batchYear.metrics.bytes;files+=batchYear.metrics.files;yearsReused++;continue;}
   const memo=yearMemo(readers?.periodFingerprint?cacheDir:null,batchYearKey,code,year);
   const cached=memo.load(identity,emit);
   if(cached){Object.assign(quarters[code],cached.quarters);for(const kind of ['daily','rental'])Object.assign(states[kind][code],cached.states[kind]);nrows+=cached.metrics.rows;newBytes+=cached.metrics.bytes;files+=cached.metrics.files;yearsReused++;if(readers?.periodFingerprint)generationSession?.save('year/'+code+'/'+year,batchYearKey,{[code]:identity},cached,Object.keys(cached.files));continue;}
   const before={rows:nrows,bytes:newBytes,files};
   const stateKey=generationSession&&readers?.stateFingerprint?[engine,code,year,ym,readers.stateFingerprint(code,ym),yearLayout]:null;
   const stateAssets=[],stateScope='state-year/'+code+'/'+year,stateAllowed=p=>new RegExp('^data/daily/regions/'+code+'/states/(?:daily|rental)/'+year+'(?:(?:-p[01]+|-order)?\\.bin|\\.parts\\.json)$').test(p);
   const stateHit=stateKey?generationSession?.load(stateScope,stateKey,{[code]:identity},stateAllowed,(p,b)=>stateAssets.push([p,b])):null;
   if(stateHit){for(const kind of ['daily','rental'])Object.assign(states[kind][code],stateHit.states[kind]);newBytes+=stateHit.metrics.bytes;files+=stateHit.metrics.files;}
   for(const q of quarterNames.filter(q=>q.startsWith(year))){const qm=months.filter(m=>m.slice(0,4)+'-Q'+Math.ceil(Number(m.slice(5))/3)===q),input={};if(!stateHit&&stateYear!==q.slice(0,4)){flushStates();stateYear=q.slice(0,4);}
   const qlayout=Object.fromEntries(Object.entries(layout).filter(([p])=>p.includes('/quarters/'+q)));
   const quarterKey=generationSession&&readers?.periodFingerprint?[engine,code,q,qm,readers.periodFingerprint(code,qm),qlayout]:null,quarterScope='quarter/'+code+'/'+q;
   const quarterAllowed=p=>new RegExp('^data/daily/regions/'+code+'/quarters/'+q+'(?:(?:-p[01]+|-order)?\\.bin|\\.parts\\.json)$').test(p);
   const quarterHit=quarterKey&&(stateHit||readers?.regionOpening)?generationSession?.load(quarterScope,quarterKey,{[code]:identity},quarterAllowed,emit):null;
   if(quarterHit){Object.assign(quarters[code],quarterHit.quarters);if(!stateHit)for(const month of qm)for(const kind of ['daily','rental'])opening[kind][month]=readers.regionOpening(kind,code,month);nrows+=quarterHit.metrics.rows;newBytes+=quarterHit.metrics.bytes;files+=quarterHit.metrics.files;quartersReused++;continue;}
   const qmemo=quarterMemo(readers?.quarterFingerprint?cacheDir:null,[engine,code,q,qm,readers?.quarterFingerprint?.(code,qm),qlayout],code,q);
   const qcached=qmemo.load(identity,emit);
   if(qcached){Object.assign(quarters[code],qcached.quarters);if(!stateHit)for(const kind of ['daily','rental'])Object.assign(opening[kind],qcached.opening[kind]);nrows+=qcached.metrics.rows;newBytes+=qcached.metrics.bytes;files+=qcached.metrics.files;quartersReused++;continue;}
   const qbefore={rows:nrows,bytes:newBytes,files};
   for(const month of qm){input[month]={daily:daily.regionMonth(code,month),rental:rental.regionMonth(code,month)};if(!stateHit)for(const kind of ['daily','rental'])opening[kind][month]=input[month][kind].opening;monthsDecoded++;}
   // Exact-area identities must exist before cache keys and encoded references are computed.
   const areas=new Set(identity.areas.map(a=>a[0]+'|'+a[1])),missing=new Map();for(const m of qm)for(const row of input[m].rental.rows){const ci=Number(row[0].slice(6)),key=ci+'|'+row[1];if(!areas.has(key))missing.set(key,[ci,row[1]]);}for(const [,a]of [...missing].sort((a,b)=>a[1][0]-b[1][0]||(a[1][1]<b[1][1]?-1:a[1][1]>b[1][1]?1:0)))identity.areas.push(a);
   const value=Object.fromEntries(qm.map(m=>[m,Object.fromEntries(['daily','rental'].map(k=>[k,{rows:input[m][k].rows,updates:input[m][k].updates}]))])),path=`data/daily/regions/${code}/quarters/${q}.bin`,part=packed(code,q,'quarter',value,identity,path);newBytes+=part.bytes;files+=part.files;if(part.reused)reused++;if(part.validationReused)validationReused++;for(const m of qm){quarters[code][m]=part.path;nrows+=input[m].daily.rows.length+input[m].rental.rows.length;}
   const qpaths=Object.keys(sources).filter(p=>quarterAllowed(p));
   if(quarterKey)generationSession?.save(quarterScope,quarterKey,{[code]:identity},{quarters:Object.fromEntries(qm.map(m=>[m,quarters[code][m]])),metrics:{rows:nrows-qbefore.rows,bytes:newBytes-qbefore.bytes,files:files-qbefore.files}},qpaths);
   if(readers?.quarterFingerprint&&cacheDir&&!stateHit){
    const qpaths=Object.keys(sources).filter(p=>p.startsWith('data/daily/regions/'+code+'/quarters/'+q));
    qmemo.save(identity,Object.fromEntries(qm.map(m=>[m,quarters[code][m]])),Object.fromEntries(['daily','rental'].map(k=>[k,Object.fromEntries(qm.map(m=>[m,opening[k][m]]))])),{rows:nrows-qbefore.rows,bytes:newBytes-qbefore.bytes,files:files-qbefore.files},qpaths.map(p=>[p,readFileSync(join(output,p))]));
   }

   }
   for(const[p,b]of stateAssets)emit(p,b);const beforeState={bytes:newBytes,files};flushStates();stateYear=null;
   if(stateKey&&!stateHit)generationSession?.save(stateScope,stateKey,{[code]:identity},{states:Object.fromEntries(['daily','rental'].map(k=>[k,Object.fromEntries(Object.entries(states[k][code]).filter(([m])=>m.startsWith(year+'-')))])),metrics:{bytes:newBytes-beforeState.bytes,files:files-beforeState.files}},Object.keys(sources).filter(stateAllowed));
   const select=entries=>Object.fromEntries(Object.entries(entries).filter(([m])=>m.startsWith(year+'-')));
   const yearPaths=Object.keys(sources).filter(p=>p.startsWith('data/daily/regions/'+code+'/')&&(p.includes('/quarters/'+year+'-Q')||p.includes('/states/daily/'+year)||p.includes('/states/rental/'+year)));
   if(readers?.periodFingerprint)generationSession?.save('year/'+code+'/'+year,batchYearKey,{[code]:identity},{quarters:select(quarters[code]),states:{daily:select(states.daily[code]),rental:select(states.rental[code])},metrics:{rows:nrows-before.rows,bytes:newBytes-before.bytes,files:files-before.files}},yearPaths);
   memo.save(identity,select(quarters[code]),{daily:select(states.daily[code]),rental:select(states.rental[code])},{rows:nrows-before.rows,bytes:newBytes-before.bytes,files:files-before.files},yearPaths.map(p=>[p,readFileSync(join(output,p))]));
  }
  flushStates();const idPath=`data/daily/regions/${code}/identities.json`,metaPath=`data/daily/regions/${code}/metadata.json`;json(idPath,identity);json(metaPath,entry.metadata);regions[code]={identities:idPath,metadata:metaPath};const metric={code,rows:nrows,files,bytes:newBytes,reused,validationReused,yearsReused,quartersReused,monthsDecoded,addedAreas:identity.areas.length-entry.identity.areas.length,regionReused:false};metrics.push(metric);
  if(readers?.regionFingerprint)generationSession?.save('region/'+code,batchKey,{[code]:identity},{quarters:quarters[code],states:{daily:states.daily[code],rental:states.rental[code]},metrics:metric},Object.keys(sources).filter(p=>p.startsWith('data/daily/regions/'+code+'/')&&!p.endsWith('metadata.json')));
  if(scopeCache){mkdirSync(scopeCache,{recursive:true});if(realpathSync(scopeCache).toLowerCase()!==scopeCache.toLowerCase())throw Error('Region packing directory link');const records={};let n=0;for(const[path,digest]of Object.entries(sources)){if(!path.startsWith(`data/daily/regions/${code}/`)||path.endsWith('metadata.json'))continue;const file=(n++)+'.bin';if(existsSync(join(scopeCache,file))&&lstatSync(join(scopeCache,file)).isSymbolicLink())throw Error('Region packing output link');writeFileSync(join(scopeCache,file),readFileSync(join(output,path)));records[path]={file,sha256:digest};}const body={code,key:scopeKey,files:records,quarters:quarters[code],states:{daily:states.daily[code],rental:states.rental[code]},metrics:metric},temp=join(scopeCache,'receipt.'+process.pid+'.tmp');writeFileSync(temp,JSON.stringify({body,sha256:hash(JSON.stringify(body))}));renameSync(temp,join(scopeCache,'receipt.json'));}
  process.stderr.write(code+' converted '+nrows+' facts / '+newBytes+' bytes\n');
 }
 json('data/daily/regions/index.json',{schema:3,format:'packed-region',regions});
 for(const kind of ['daily','rental']){
  const old=kind==='daily'?daily.manifest:rental.manifest,m=structuredClone(old);m.schema=3;m.regional={format:'packed-region',kind,authority:'data/daily/regions/index.json',quarters,states:states[kind]};m.sources=Object.fromEntries(Object.entries(sources).filter(([p])=>!p.includes('/states/'+(kind==='daily'?'rental':'daily')+'/')));
  for(const path of kind==='daily'?['data/map/index.json']:['data/rental/rates.json','data/rental/summary.json']){const bytes=readFileSync(join(root,path));if(hash(bytes)!==old.sources[path])throw Error('Changed supplemental input');m.sources[path]=hash(bytes);inputs[path]=hash(bytes);if(kind==='rental')emit(path,bytes);}
  // Neither timestamps nor whole-site release SHA are included in new transaction files.
  const semantic=JSON.stringify({regional:m.regional,sources:m.sources});m.version=hash(semantic);delete m.updated;mkdirSync(join(output,'data',kind),{recursive:true});writeFileSync(join(output,`data/${kind}/index.json`),JSON.stringify(m));
 }
 if(priorBytes&&!readFileSync(join(previousRoot,'data/daily/index.json')).equals(priorBytes)||priorRentalBytes&&!readFileSync(join(previousRoot,'data/rental/index.json')).equals(priorRentalBytes))throw Error('Previous layout manifest changed during packaging');
 Object.assign(inputs,daily.inputs,rental.inputs);for(const[path,digest]of Object.entries(inputs))if(hash(readFileSync(join(root,path)))!==digest)throw Error('Input changed during conversion');if(readers)readers.verify();
 const report={schema:1,status:'CONVERTED_VERIFIED',publicDeployment:false,sourceManifestHashes:{daily:hash(readFileSync(join(root,'data/daily/index.json'))),rental:hash(readFileSync(join(root,'data/rental/index.json')))},inputs,metrics};writeFileSync(join(output,'housing-conversion.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const[root,output,codecPath,...codes]=process.argv.slice(2);if(!root||!output||!codecPath)throw Error('SITE OUTPUT CODEC [LAWD ...] required');const codec=await import(pathToFileURL(codecPath));const report=buildHousingRegions(root,output,codec,{codes:codes.length?codes:null});console.log(JSON.stringify({status:report.status,regions:report.metrics.length,rows:report.metrics.reduce((n,r)=>n+r.rows,0),bytes:report.metrics.reduce((n,r)=>n+r.bytes,0)}));}
