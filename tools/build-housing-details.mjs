// Read-only migration of published apartment contracts into references + sparse extras.
import{readFileSync,writeFileSync,mkdirSync,realpathSync}from'node:fs';import{resolve,join,dirname}from'node:path';import{gzipSync}from'node:zlib';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';import assert from'node:assert/strict';
import{regionalReader}from'./regional-data.mjs';import{packContractDetails,restoreDetails}from'../js/housing-contract-detail.mjs';import*as codec from'../js/generated/housing-columns.mjs';
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
export function buildHousingDetails(source,packed,previous=null){
 source=realpathSync(source);packed=realpathSync(packed);if(source===packed)throw Error('Isolated output required');const rental=regionalReader(packed,'rental');if(rental.manifest.schema!==3)throw Error('Packed facts required');
 const input=new Map(),read=p=>{const b=readFileSync(join(source,p));input.set(p,hash(b));return JSON.parse(b);},old=read('data/contracts/index.json');if(old.schema!==1)throw Error('Raw generated contract manifest required');
 const displays=new Map();
 const manifest={...old,schema:2,rentalVersion:rental.manifest.version,sources:{},partitions:[]},retired={},metrics={matched:0,unmatched:0,oldBytes:0,newBytes:0};
 function emit(p,b){const file=join(packed,p);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,b);manifest.sources[p]=hash(b);metrics.newBytes+=b.length;}
 for(const p of old.partitions){const path='data/contracts/'+p.path;if(p.service!=='apartment-rent'){const b=readFileSync(join(source,path));input.set(path,hash(b));manifest.sources[path]=hash(b);manifest.partitions.push(p);continue;}
  if(!/^apartment-rent\/\d{5}\/\d{6}\.json$/.test(p.path))throw Error('Unsafe source partition');const raw=read(path).rows;if(raw.length!==p.count)throw Error('Contract count mismatch');const month=p.month.slice(0,4)+'-'+p.month.slice(4),regionCodes=[...new Set(raw.map(row=>rental.table.source.get(row.entityId)?.split(':')[0]).filter(Boolean))].sort(),facts=regionCodes.flatMap(code=>rental.regionMonth(code,month,false).rows);
  const value=packContractDetails(raw,facts,rental.table,codec);assert.deepEqual(restoreDetails(value.details,value.unmatched,value.display,facts,rental.table,codec).map(canonical).sort(),raw.map(canonical).sort());
  const prefix=`data/contracts/apartment-rent/${p.lawd}/${p.month}`,details=value.matched?prefix+'-details.bin':null,unmatched=value.unmatchedCount?prefix+'-unmatched.bin':null,display=value.matched?`data/contracts/apartment-rent/${p.lawd}/display.json`:null;
  if(details)emit(details,gzipSync(value.details,{level:6}));if(unmatched)emit(unmatched,gzipSync(value.unmatched,{level:6}));
  // Deduplicate display text outside transaction files. Exceptions retain original source wording.
  if(display){if(!displays.has(display))displays.set(display,{});const refs=displays.get(display);for(const[id,meta]of Object.entries(value.display)){if(refs[id]&&canonical(refs[id])!==canonical(meta))throw Error('Conflicting contract display identity');refs[id]=meta;}}
  manifest.partitions.push({...p,path:p.path.replace('.json','.bin'),format:'regional-reference',regionCodes,details,unmatched,display});retired[path]=input.get(path);metrics.oldBytes+=readFileSync(join(source,path)).length;metrics.matched+=value.matched;metrics.unmatched+=value.unmatchedCount;
 }
 for(const[path,values]of displays){const dictionary=[],refs={},lookup=new Map();for(const[id,meta]of Object.entries(values).sort(([a],[b])=>a.localeCompare(b))){const key=canonical(meta);let n=lookup.get(key);if(n===undefined){n=dictionary.length;dictionary.push(meta);lookup.set(key,n);}refs[id]=n;}emit(path,Buffer.from(JSON.stringify({dictionary,refs})));}
 const retained=previous?retainUnconvertedContracts(realpathSync(previous),manifest,(p,b)=>{emit(p,b);metrics.newBytes-=b.length;}):null;
 emit('data/contracts/index.json',Buffer.from(JSON.stringify(manifest)));
 const rent=read('data/apartment-rent/index.json');for(const[path,digest]of Object.entries(rent.shards)){const b=readFileSync(join(source,path));if(hash(b)!==digest)throw Error('Rent shard changed');retired[path]=digest;metrics.oldBytes+=b.length;input.set(path,digest);}
 const next={schema:2,unit:rent.unit,total:rent.total,linked:rent.linked,records:Object.fromEntries(Object.entries(rent.records).map(([id,{shard,...r}])=>[id,r])),coverage:rent.coverage,sharedManifest:'data/rental/index.json',rentalVersion:rental.manifest.version,contractsHash:hash(readFileSync(join(packed,'data/contracts/index.json'))),catalogHash:hash(readFileSync(join(packed,'data/apartments/index.json')))};
 emit('data/apartment-rent/index.json',Buffer.from(JSON.stringify(next)));
 for(const[p,h]of input)if(hash(readFileSync(join(source,p)))!==h)throw Error('Contract input changed');
 retained?.verify();const report={retainedUnconverted:retained?{files:retained.files,bytes:retained.bytes,inputs:retained.inputs}:null,status:'PASS',metrics,retired,inputs:Object.fromEntries(input)};writeFileSync(join(packed,'housing-details-report.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(buildHousingDetails(...process.argv.slice(2)).metrics));
