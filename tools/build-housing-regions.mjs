import{packedMemo,identityDependencies}from'./housing-packing-cache.mjs';
import{partitionHousing}from'./housing-partition.mjs';import{partitionDescriptor,joinPartition}from'../js/housing-partition.mjs';
import{readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync}from'node:fs';
import{resolve,dirname,join,sep}from'node:path';import{createHash}from'node:crypto';import{gzipSync,gunzipSync}from'node:zlib';import{pathToFileURL}from'node:url';import assert from'node:assert/strict';
import{regionalReader}from'./regional-data.mjs';import{packQuarter,encodeQuarter,decodeQuarter}from'../js/housing-quarter.mjs';import{packStateTimeline,encodeStateFile,decodeStateFile}from'../js/housing-state-timeline.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function buildHousingRegions(root,output,codec,{codes=null,readers=null,previousRoot=null,cacheDir=null}={}){
 root=realpathSync(root);output=resolve(output);if(root===output||output.startsWith(root+sep)||root.startsWith(output+sep))throw Error('Isolated output required');
 mkdirSync(output,{recursive:true});if(realpathSync(output).toLowerCase()!==output.toLowerCase())throw Error('Output link not allowed');
 const daily=readers?.daily??regionalReader(root,'daily'),rental=readers?.rental??regionalReader(root,'rental');if(daily.manifest.schema!==2||rental.manifest.schema!==2)throw Error('Verified schema 2 input required for initial migration');
 const engine=hash(['../js/housing-quarter.mjs','../js/housing-facts.mjs','../js/housing-state-timeline.mjs','../js/housing-partition.mjs','./housing-partition.mjs','../js/generated/housing-columns.mjs'].map(p=>hash(readFileSync(new URL(p,import.meta.url)))).join('|'));
 function packed(code,scope,kind,value,identity,path){const previous=boundaries(path,kind),key=[engine,code,scope,kind,value,identityDependencies(identity,value,kind),previous?.leaves.map(x=>x.prefix)||null];
  return packedMemo(cacheDir,key,emit=>partitionHousing({code,scope,kind,months:value,identity,codec,path,emit,previous}), (result,files)=>{if(result.path!==path&&result.path!==path.slice(0,-4)+'.parts.json')throw Error('Cache output scope mismatch');const allowed=result.path.endsWith('.parts.json')?[result.path,...partitionDescriptor(JSON.parse(files.get(result.path)),result.path,Object.fromEntries([...files].map(([p,b])=>[p,hash(b)])))]:[path];if(files.size!==allowed.length||[...files].some(([p,b])=>!allowed.includes(p)||b.length>20*1024*1024))throw Error('Cache output inventory mismatch');const raw=p=>new Uint8Array(gunzipSync(files.get(p)));let reader;
   if(result.path.endsWith('.parts.json')){const desc=JSON.parse(files.get(result.path)),sources=Object.fromEntries([...files].map(([p,b])=>[p,hash(b)]));partitionDescriptor(desc,result.path,sources);reader=joinPartition(desc,desc.leaves.map(x=>raw(x.path)),raw(desc.order),identity,codec);}else reader=kind==='quarter'?decodeQuarter(raw(result.path),identity,codec,{lawd:code,quarter:scope}):decodeStateFile(raw(result.path),codec,{lawd:code,kind});
   for(const m of Object.keys(value)){if(kind==='quarter'){for(const k of ['daily','rental'])for(const field of ['rows','updates'])assert.deepEqual(reader.month(m)[k][field],value[m][k][field]);}else assert.deepEqual(reader.month(m),value[m]);}
  },emit);
 }
 const prior=previousRoot?JSON.parse(readFileSync(join(previousRoot,'data/daily/index.json'))):null;
 function boundaries(path,kind){if(!prior||prior.schema!==3)return null;const m=kind==='rental'?JSON.parse(readFileSync(join(previousRoot,'data/rental/index.json'))):prior,p=path.slice(0,-4)+'.parts.json';if(!m.sources[p])return null;const b=readFileSync(join(previousRoot,p));if(hash(b)!==m.sources[p])throw Error('Previous partition changed');const v=JSON.parse(b);partitionDescriptor(v,p,m.sources);return v;}
 const inputs={},sources={},quarters={},states={daily:{},rental:{}},regions={},metrics=[];
 const emit=(path,bytes)=>{if(!path.startsWith('data/')||path.includes('..'))throw Error('Unsafe output');const target=join(output,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);sources[path]=hash(bytes);return bytes.length;};
 const json=(path,value)=>emit(path,Buffer.from(JSON.stringify(value)));
 const selected=codes??[...daily.table.regions.keys()].sort();
 for(const code of selected){
  const entry=daily.table.regions.get(code);if(!entry)throw Error('Unknown region');const identity=structuredClone(entry.identity);
  const months=[...new Set([...Object.keys(daily.manifest.regional.bases?.[code]||{}),...Object.keys(daily.manifest.regional.overlays?.[code]||{}),...Object.keys(rental.manifest.regional.bases?.[code]||{}),...Object.keys(rental.manifest.regional.overlays?.[code]||{})])].sort();
  const quarterNames=[...new Set(months.map(m=>m.slice(0,4)+'-Q'+Math.ceil(Number(m.slice(5))/3)))];quarters[code]={};states.daily[code]={};states.rental[code]={};
  let stateYear=null,opening={daily:{},rental:{}},nrows=0,newBytes=0,files=0;
  let reused=0;
  function flushStates(){if(stateYear===null)return;for(const kind of ['daily','rental']){if(Object.values(opening[kind]).every(rows=>rows.length===0)){for(const month of Object.keys(opening[kind]))states[kind][code][month]=null;continue;}const path=`data/daily/regions/${code}/states/${kind}/${stateYear}.bin`,part=packed(code,stateYear,kind,opening[kind],identity,path);newBytes+=part.bytes;files+=part.files;if(part.reused)reused++;for(const month of Object.keys(opening[kind]))states[kind][code][month]=part.path;}opening={daily:{},rental:{}};}

  for(const q of quarterNames){const qm=months.filter(m=>m.slice(0,4)+'-Q'+Math.ceil(Number(m.slice(5))/3)===q),input={};if(stateYear!==q.slice(0,4)){flushStates();stateYear=q.slice(0,4);}
   for(const month of qm){input[month]={daily:daily.regionMonth(code,month),rental:rental.regionMonth(code,month)};for(const kind of ['daily','rental'])opening[kind][month]=input[month][kind].opening;}
   // Exact-area identities must exist before cache keys and encoded references are computed.
   const areas=new Set(identity.areas.map(a=>a[0]+'|'+a[1])),missing=new Map();for(const m of qm)for(const row of input[m].rental.rows){const ci=Number(row[0].slice(6)),key=ci+'|'+row[1];if(!areas.has(key))missing.set(key,[ci,row[1]]);}for(const [,a]of [...missing].sort((a,b)=>a[1][0]-b[1][0]||(a[1][1]<b[1][1]?-1:a[1][1]>b[1][1]?1:0)))identity.areas.push(a);
   const value=Object.fromEntries(qm.map(m=>[m,Object.fromEntries(['daily','rental'].map(k=>[k,{rows:input[m][k].rows,updates:input[m][k].updates}]))])),path=`data/daily/regions/${code}/quarters/${q}.bin`,part=packed(code,q,'quarter',value,identity,path);newBytes+=part.bytes;files+=part.files;if(part.reused)reused++;for(const m of qm){quarters[code][m]=part.path;nrows+=input[m].daily.rows.length+input[m].rental.rows.length;}

  }
  flushStates();const idPath=`data/daily/regions/${code}/identities.json`,metaPath=`data/daily/regions/${code}/metadata.json`;json(idPath,identity);json(metaPath,entry.metadata);regions[code]={identities:idPath,metadata:metaPath};metrics.push({code,rows:nrows,files,bytes:newBytes,reused,addedAreas:identity.areas.length-entry.identity.areas.length});process.stderr.write(code+' converted '+nrows+' facts / '+newBytes+' bytes\n');
 }
 json('data/daily/regions/index.json',{schema:3,format:'packed-region',regions});
 for(const kind of ['daily','rental']){
  const old=kind==='daily'?daily.manifest:rental.manifest,m=structuredClone(old);m.schema=3;m.regional={format:'packed-region',kind,authority:'data/daily/regions/index.json',quarters,states:states[kind]};m.sources=Object.fromEntries(Object.entries(sources).filter(([p])=>!p.includes('/states/'+(kind==='daily'?'rental':'daily')+'/')));
  for(const path of kind==='daily'?['data/map/index.json']:['data/rental/rates.json','data/rental/summary.json']){const bytes=readFileSync(join(root,path));if(hash(bytes)!==old.sources[path])throw Error('Changed supplemental input');m.sources[path]=hash(bytes);inputs[path]=hash(bytes);if(kind==='rental')emit(path,bytes);}
  // Neither timestamps nor whole-site release SHA are included in new transaction files.
  const semantic=JSON.stringify({regional:m.regional,sources:m.sources});m.version=hash(semantic);delete m.updated;mkdirSync(join(output,'data',kind),{recursive:true});writeFileSync(join(output,`data/${kind}/index.json`),JSON.stringify(m));
 }
 Object.assign(inputs,daily.inputs,rental.inputs);for(const[path,digest]of Object.entries(inputs))if(hash(readFileSync(join(root,path)))!==digest)throw Error('Input changed during conversion');if(readers)readers.verify();
 const report={schema:1,status:'CONVERTED_VERIFIED',publicDeployment:false,sourceManifestHashes:{daily:hash(readFileSync(join(root,'data/daily/index.json'))),rental:hash(readFileSync(join(root,'data/rental/index.json')))},inputs,metrics};writeFileSync(join(output,'housing-conversion.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const[root,output,codecPath,...codes]=process.argv.slice(2);if(!root||!output||!codecPath)throw Error('SITE OUTPUT CODEC [LAWD ...] required');const codec=await import(pathToFileURL(codecPath));const report=buildHousingRegions(root,output,codec,{codes:codes.length?codes:null});console.log(JSON.stringify({status:report.status,regions:report.metrics.length,rows:report.metrics.reduce((n,r)=>n+r.rows,0),bytes:report.metrics.reduce((n,r)=>n+r.bytes,0)}));}
