// Local candidate adapter. Transaction summaries and permanent aliases are reused.
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,join,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {mapBoundaryReference,mapBoundarySources} from './map-boundary-metadata.mjs';
import {buildApartmentEntries} from './build-apartment-entries.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(root,path)=>{const r=relative(root,path);return r===''||(!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r));};
function pathAt(root,name){
  if(!name||name.split('/').some(p=>!p||p==='.'||p==='..'||/[\\:]/.test(p)))throw Error('Invalid candidate path');
  let path=root;
  for(const part of name.split('/')){path=join(path,part);if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('Linked candidate path');}
  return path;
}
export function refreshMetadata(baseline,candidate){
  baseline=realpathSync(baseline);candidate=realpathSync(candidate);
  if(inside(baseline,candidate)||inside(candidate,baseline))throw Error('Candidate must be separate from the baseline');
  if(!candidate.split(/[\\/]/).includes('_ops'))throw Error('Candidate must be inside an _ops directory');
  const read=(root,name)=>JSON.parse(readFileSync(pathAt(root,name),'utf8'));
  const housing=read(candidate,'data/housing-v3/index.json'),map=read(candidate,'data/map/index.json');
  if(housing.meta?.candidateOnly!==true||housing.meta?.approvedOnly!==false)throw Error('Explicit unapproved candidate required');
  if(existsSync(pathAt(candidate,'data/apartments/index.json')))throw Error('Metadata candidate already exists');
  const original=read(baseline,'data/apartments/index.json');
  if(original.version!==2)throw Error('Packed apartment version 2 is required to reuse transaction facts');
  const index=structuredClone(original),publications=new Map(housing.complexes.filter(p=>p.housingFamily==='apartment').map(p=>[p.id,p]));
  const boundaries=mapBoundarySources(map);
  for(const[name,expected]of Object.entries(boundaries))if(digest(readFileSync(pathAt(candidate,name)))!==expected)throw Error('Candidate map boundary source mismatch: '+name);
  const locations=new Map(map.d.map(p=>[p.publicationId||p.id,p])),remaining=new Map(publications),outputs={};
  if([...publications.values()].some(p=>p.legacyGroup||p.splitFrom))throw Error('Parcel differences cannot split an existing apartment identity');
  const write=(name,value)=>{const bytes=Buffer.from(JSON.stringify(value));const path=pathAt(candidate,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);outputs[name]=digest(bytes);return outputs[name];};
  const salePath='data/sale-details/index.json',history=existsSync(pathAt(baseline,salePath))?read(baseline,salePath):null;
  if(history?.format==='sale-fact-references'){
    map.meta.sources[salePath]=digest(readFileSync(pathAt(baseline,salePath)));
    map.meta.sourceVersion=digest(JSON.stringify(map.meta.sources)).slice(0,16);write('data/map/index.json',map);
  }
  const pending=Array.from({length:256},()=>[]);
  for(const p of publications.values()){
    if(index.lookup[p.id]?.[0]===p.id)continue;
    if(index.lookup[p.id])throw Error('Current public identity conflicts with an existing alias: '+p.id);
    const shard=digest(p.id).slice(0,2);pending[parseInt(shard,16)].push(p);
    index.lookup[p.id]=[p.id,shard];
  }
  const claims=new Map(),aliasConflicts=new Map();let aliasesAdded=0;
  for(const p of publications.values())for(const alias of [...p.transactionKeys||[],...p.legacyIds||[]]){
    if(!claims.has(alias))claims.set(alias,new Set());claims.get(alias).add(p.id);
  }
  const ambiguous=new Set(index.ambiguous||[]);
  for(const[alias,claimants]of claims){
    const existing=index.lookup[alias];
    if(!existing&&claimants.size===1){index.lookup[alias]=[...index.lookup[[...claimants][0]]];aliasesAdded++;continue;}
    if(!existing)ambiguous.add(alias);
    for(const id of claimants){
      if(existing?.[0]===id)continue;
      if(!aliasConflicts.has(id))aliasConflicts.set(id,[]);
      aliasConflicts.get(id).push({alias,existingCanonicalId:existing?.[0]??null,claimedBy:[...claimants].sort()});
    }
  }
  index.ambiguous=[...ambiguous].sort();
  let preserved=0,added=0;
  function update(dto,p,location){
    // Preserve source transaction names, exact areas, rows, comments and all price statistics.
    const conflicts=aliasConflicts.get(dto.id)||[],review={...(p?.review??{approved:false,state:'current_target_missing'})};
    if(conflicts.length)Object.assign(review,{approved:false,identityUnresolved:true,identityRequiresReview:true,sourceAliasConflicts:conflicts});
    const out={...dto,name:p?.name||dto.name,address:p?.lotAddress||dto.address,road:p?.roadAddress||'',region:p?.region||dto.region,
      units:p?.units??null,parking:null,far:null,coord:location?.coord??null,pnus:p?.parcels||[],parcelScope:location?.scope??null,
      rental:p?.tenure==='rental',sources:[...new Set([...(dto.sources||[]),...(p?.transactionKeys||[]).filter(source=>index.lookup[source]?.[0]===dto.id)])],
      conflict:!!(dto.conflict||!p||review.identityUnresolved||review.identityConflict||review.identityRequiresReview),review,
      status:location?.status||'unknown',propertyUpdated:housing.meta.updated??null,corrections:location?.corrections||[],
      map:{...(dto.map||{}),boundary:mapBoundaryReference(location),displayBounds:location?.displayBounds??null},
      registry:(p?.registry||[]).map(r=>({name:r.dong_name||r.name||'',purpose:r.purpose??null,units:r.units??null}))};
    out.areas=dto.areas.map(a=>({...a,units:null,rows:(a.rows||[]).map(r=>({...r,units:null,metrics:r.metrics?{...r.metrics,land:null,landKind:null,landVerified:null,far:null}:r.metrics}))}));
    return out;
  }
  for(let n=0;n<256;n++){
    const shard=n.toString(16).padStart(2,'0');
    const files=['data/apartments/'+shard+'.json','data/apartments/summary/'+shard+'.json'];
    const values=files.map(name=>{const bytes=readFileSync(pathAt(baseline,name));if(digest(bytes)!==original.shards[name])throw Error('Baseline shard changed: '+name);return JSON.parse(bytes);});
    const [details,shorts]=values;
    for(const [id,dto] of Object.entries(details)){
      const p=publications.get(id),location=locations.get(id);details[id]=update(dto,p,location);remaining.delete(id);preserved++;
      if(!shorts[id])throw Error('Missing baseline summary: '+id);
      Object.assign(shorts[id],{name:details[id].name,address:details[id].address,region:details[id].region,rental:details[id].rental});
    }
    for(const p of pending[n]){
      const dto=update({id:p.id,name:p.name,address:p.lotAddress,years:[],rental:p.tenure==='rental',conflict:false,
        updated:housing.meta.updated??null,areas:[],sources:[]},p,locations.get(p.id));
      details[p.id]=dto;shorts[p.id]={id:p.id,name:dto.name,region:dto.region,district:p.gu||'',address:dto.address,updated:dto.updated,rental:dto.rental,areas:[]};
      index.lookup[p.id]=[p.id,shard];remaining.delete(p.id);added++;
    }
    for(let i=0;i<2;i++)index.shards[files[i]]=write(files[i],values[i]);
  }
  if(remaining.size)throw Error('Unresolved output identities');
  index.count=preserved+added;
  delete index.sources['data/building-status.json'];
  for(const name of Object.keys(index.sources))if(name.startsWith('data/map/boundaries/'))delete index.sources[name];
  Object.assign(index.sources,boundaries);
  for(const name of ['data/index.json','data/map/index.json','data/housing-v3/index.json'])index.sources[name]=digest(readFileSync(pathAt(candidate,name)));
  write('data/apartments/index.json',index);
  if(history?.format==='sale-fact-references'){
    const rent=read(baseline,'data/apartment-rent/index.json');rent.catalogHash=outputs['data/apartments/index.json'];write('data/apartment-rent/index.json',rent);
    Object.assign(outputs,buildApartmentEntries(candidate,{fallback:baseline}).files);
    outputs['data/apartments/entry-index.json']=digest(readFileSync(pathAt(candidate,'data/apartments/entry-index.json')));
  }
  const report={schema:1,status:'PREVIEW_METADATA_CREATED',candidateOnly:true,baseline,candidate,existingEntitiesPreserved:preserved,newMetadataOnlyEntities:added,
    oldAliasesPreserved:Object.keys(original.lookup).filter(k=>JSON.stringify(index.lookup[k])===JSON.stringify(original.lookup[k])).length,
    oldCommentIdsPreserved:Object.keys(original.legacy).length,transactionFilesRead:0,
    newAliasesAdded:aliasesAdded,sourceAliasConflictPublications:aliasConflicts.size,
    factSource:'baseline data/apartments packed DTO summaries; apartment identities retained; no transaction aggregation',outputs};
  writeFileSync(join(candidate,'metadata-refresh.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4)throw Error('Usage: node refresh-current-review-metadata.mjs BASELINE CANDIDATE');
  const result=refreshMetadata(process.argv[2],process.argv[3]);console.log(JSON.stringify({...result,outputs:undefined}));
}
