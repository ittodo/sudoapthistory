import{contractInput}from'./housing-contract-input.mjs';
import{detailMemo,detailEngine,detailDependencies,detailIdentity}from'./housing-detail-cache.mjs';
// Read-only migration of published apartment contracts into references + sparse extras.
import{readFileSync,writeFileSync,mkdirSync,realpathSync}from'node:fs';import{resolve,join,dirname}from'node:path';import{gzipSync}from'node:zlib';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';import assert from'node:assert/strict';
import{regionalReader}from'./regional-reader.mjs';import{packContractDetails,restoreDetails}from'../js/housing-contract-detail.mjs';import*as codec from'../js/generated/housing-columns.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),canonical=r=>JSON.stringify(Object.fromEntries(Object.keys(r).sort().map(k=>[k,r[k]])));
export function retainUnconvertedContracts(previous,manifest,emit){
 const inputs=new Map(),read=p=>{const b=readFileSync(join(previous,p));inputs.set(p,hash(b));return b;},prior=JSON.parse(read('data/contracts/index.json'));if(![1,2].includes(prior.schema))throw Error('Unsupported previous contract manifest');
 const present=new Set(manifest.partitions.map(p=>p.path));let files=0,bytes=0;
 for(const p of prior.partitions){if(p.service==='apartment-rent'||present.has(p.path))continue;
  if(!['rowhouse-rent','officetel-sale','officetel-rent'].includes(p.service)||!/^\d{5}$/.test(p.lawd)||!/^\d{6}$/.test(p.month)||p.path!==`${p.service}/${p.lawd}/${p.month}.json`)throw Error('Unsafe retained contract partition');
  const path='data/contracts/'+p.path,b=read(path),value=JSON.parse(b);if((prior.schema===2&&prior.sources[path]!==hash(b))||value.rows.length!==p.count||value.rows.some(r=>r.date.replaceAll('-','').slice(0,6)!==p.month))throw Error('Retained contract evidence mismatch');
  emit(path,b);manifest.partitions.push(p);manifest.sources[path]=hash(b);present.add(p.path);files++;bytes+=b.length;
 }
 manifest.partitions.sort((a,b)=>a.path.localeCompare(b.path,'en'));
 return {files,bytes,inputs:Object.fromEntries(inputs),verify(){for(const[p,h]of inputs)if(hash(readFileSync(join(previous,p)))!==h)throw Error('Previous contract input changed');}};
}
export function buildHousingDetails(source,packed,previous=null,{cacheDir=null,generationSession=null}={}){
 source=realpathSync(source);packed=realpathSync(packed);if(source===packed)throw Error('Isolated output required');const rental=regionalReader(packed,'rental',{verifyOnce:true});if(rental.manifest.schema!==3)throw Error('Packed facts required');
 const input=new Map(),read=p=>{const b=readFileSync(join(source,p));input.set(p,hash(b));return JSON.parse(b);},old=read('data/contracts/index.json');if(old.schema!==1)throw Error('Raw generated contract manifest required');
 const displays=new Map(),engine=detailEngine('build-housing-details.mjs'),reuse={months:0,builtMonths:0},inputReuse={partitions:0,parsed:0};
 const manifest={...old,schema:2,rentalVersion:rental.manifest.version,sources:{},partitions:[]},retired={},metrics={matched:0,unmatched:0,oldBytes:0,newBytes:0};
 function emit(p,b){const file=join(packed,p);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,b);manifest.sources[p]=hash(b);metrics.newBytes+=b.length;}
 for(const privatePartition of old.partitions){const {sourceHash,...p}=privatePartition;const path='data/contracts/'+p.path;if(p.service!=='apartment-rent'){const b=readFileSync(join(source,path));input.set(path,hash(b));manifest.sources[path]=hash(b);manifest.partitions.push(p);continue;}
  if(!/^apartment-rent\/\d{5}\/\d{6}\.json$/.test(p.path))throw Error('Unsafe source partition');const batchScope='rental/'+p.lawd+'/'+p.month,oldScope=generationSession?.peek(batchScope),month=p.month.slice(0,4)+'-'+p.month.slice(4);
  if(oldScope&&typeof sourceHash==='string'){
   const entities=oldScope.result.entities,regionCodes=[...new Set(entities.map(id=>rental.table.source.get(id)?.split(':')[0]).filter(Boolean))].sort(),dependencies=Object.assign({},...regionCodes.map(code=>detailDependencies(rental,code,[month]))),mapping=entities.map(id=>[id,rental.table.source.get(id)||null]);
   const key=[engine,p.service,p.lawd,p.month,p.count,p.rejectedCount||0,sourceHash,dependencies,mapping];
   const hit=generationSession.load(batchScope,key,detailIdentity(rental.table,regionCodes),name=>name==='data/contracts/apartment-rent/'+p.lawd+'/'+p.month+'-details.bin'||name==='data/contracts/apartment-rent/'+p.lawd+'/'+p.month+'-unmatched.bin',emit);
   if(hit){manifest.partitions.push({...p,...hit.partition});retired[path]=sourceHash;metrics.oldBytes+=hit.inputBytes;metrics.matched+=hit.matched;metrics.unmatched+=hit.unmatchedCount;reuse.months++;generationSession.metrics.rawInputsSkipped++;
    if(hit.partition.display){if(!displays.has(hit.partition.display))displays.set(hit.partition.display,{});const refs=displays.get(hit.partition.display);for(const[id,meta]of Object.entries(hit.display)){if(refs[id]&&canonical(refs[id])!==canonical(meta))throw Error('Conflicting contract display identity');refs[id]=meta;}}continue;
   }
  }
  const sourceBytes=readFileSync(join(source,path)),selection=contractInput(cacheDir,engine,p,sourceBytes);input.set(path,selection.digest);const regionCodes=[...new Set(selection.entities.map(id=>rental.table.source.get(id)?.split(':')[0]).filter(Boolean))].sort();
  const dependencies=Object.assign({},...regionCodes.map(code=>detailDependencies(rental,code,[month]))),mapping=selection.entities.map(id=>[id,rental.table.source.get(id)||null]);
  const cached=detailMemo(cacheDir,[engine,'rental',p,input.get(path),month,dependencies,mapping],detailIdentity(rental.table,regionCodes),name=>name===`data/contracts/apartment-rent/${p.lawd}/${p.month}-details.bin`||name===`data/contracts/apartment-rent/${p.lawd}/${p.month}-unmatched.bin`,()=>{
  const raw=selection.rows(),facts=regionCodes.flatMap(code=>rental.regionMonth(code,month,false).rows);
  const value=packContractDetails(raw,facts,rental.table,codec);assert.deepEqual(restoreDetails(value.details,value.unmatched,value.display,facts,rental.table,codec).map(canonical).sort(),raw.map(canonical).sort());
  const prefix=`data/contracts/apartment-rent/${p.lawd}/${p.month}`,files=new Map();
  if(value.matched)files.set(prefix+'-details.bin',gzipSync(value.details,{level:6}));if(value.unmatchedCount)files.set(prefix+'-unmatched.bin',gzipSync(value.unmatched,{level:6}));
  return{result:{matched:value.matched,unmatchedCount:value.unmatchedCount,display:value.display},files};
  });
  if(selection.reused)inputReuse.partitions++;if(selection.parsed)inputReuse.parsed++;if(cached.reused)reuse.months++;else reuse.builtMonths++;const value=cached.result;
  const prefix=`data/contracts/apartment-rent/${p.lawd}/${p.month}`,details=value.matched?prefix+'-details.bin':null,unmatched=value.unmatchedCount?prefix+'-unmatched.bin':null,display=value.matched?`data/contracts/apartment-rent/${p.lawd}/display.json`:null;
  for(const[p,b]of cached.files)emit(p,b);
  // Deduplicate display text outside transaction files. Exceptions retain original source wording.
  if(display){if(!displays.has(display))displays.set(display,{});const refs=displays.get(display);for(const[id,meta]of Object.entries(value.display)){if(refs[id]&&canonical(refs[id])!==canonical(meta))throw Error('Conflicting contract display identity');refs[id]=meta;}}
  const publicPartition={path:p.path.replace('.json','.bin'),format:'regional-reference',regionCodes,details,unmatched,display};
  if(typeof sourceHash==='string'){if(sourceHash!==selection.digest)throw Error('Generated contract source hash mismatch');generationSession?.save(batchScope,[engine,p.service,p.lawd,p.month,p.count,p.rejectedCount||0,sourceHash,dependencies,mapping],detailIdentity(rental.table,regionCodes),{partition:publicPartition,entities:selection.entities,inputBytes:selection.bytes,matched:value.matched,unmatchedCount:value.unmatchedCount,display:value.display},[details,unmatched].filter(Boolean));}
  manifest.partitions.push({...p,...publicPartition});retired[path]=input.get(path);metrics.oldBytes+=selection.bytes;metrics.matched+=value.matched;metrics.unmatched+=value.unmatchedCount;
 }
 for(const[path,values]of displays){const dictionary=[],refs={},lookup=new Map();for(const[id,meta]of Object.entries(values).sort(([a],[b])=>a.localeCompare(b))){const key=canonical(meta);let n=lookup.get(key);if(n===undefined){n=dictionary.length;dictionary.push(meta);lookup.set(key,n);}refs[id]=n;}emit(path,Buffer.from(JSON.stringify({dictionary,refs})));}
 const retained=previous?retainUnconvertedContracts(realpathSync(previous),manifest,(p,b)=>{emit(p,b);metrics.newBytes-=b.length;}):null;
 emit('data/contracts/index.json',Buffer.from(JSON.stringify(manifest)));
 const rent=read('data/apartment-rent/index.json');for(const[path,digest]of Object.entries(rent.shards)){const b=readFileSync(join(source,path));if(hash(b)!==digest)throw Error('Rent shard changed');retired[path]=digest;metrics.oldBytes+=b.length;input.set(path,digest);}
 const next={schema:2,unit:rent.unit,total:rent.total,linked:rent.linked,records:Object.fromEntries(Object.entries(rent.records).map(([id,{shard,...r}])=>[id,r])),coverage:rent.coverage,sharedManifest:'data/rental/index.json',rentalVersion:rental.manifest.version,contractsHash:hash(readFileSync(join(packed,'data/contracts/index.json'))),catalogHash:hash(readFileSync(join(packed,'data/apartments/index.json')))};
 emit('data/apartment-rent/index.json',Buffer.from(JSON.stringify(next)));
 for(const[p,h]of input)if(hash(readFileSync(join(source,p)))!==h)throw Error('Contract input changed');
 retained?.verify();rental.recheck();const report={reuse,inputReuse,retainedUnconverted:retained?{files:retained.files,bytes:retained.bytes,inputs:retained.inputs}:null,status:'PASS',metrics,retired,inputs:Object.fromEntries(input)};writeFileSync(join(packed,'housing-details-report.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(buildHousingDetails(...process.argv.slice(2)).metrics));
