// Candidate-only map bindings. Packed transaction facts and source identities stay unchanged.
import {readFileSync,writeFileSync,lstatSync,realpathSync,mkdirSync,renameSync,rmSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,sep,parse,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const hash=b=>createHash('sha256').update(b).digest('hex');
const inside=(root,path)=>{const r=relative(root,path);return r!==''&&!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r);};
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function checkedRoot(value){
  const root=resolve(value);let path=parse(root).root;
  for(const part of relative(path,root).split(sep).filter(Boolean)){path=join(path,part);if(lstatSync(path).isSymbolicLink())throw Error('Linked timeline root');}
  if(!lstatSync(root).isDirectory()||!same(root,realpathSync(root)))throw Error('Invalid timeline root');
  return root;
}
function pathAt(root,name){
  if(!name||name.split('/').some(p=>!p||p==='.'||p==='..'||/[\\:]/.test(p)))throw Error('Invalid timeline path');
  let path=root;
  for(const part of name.split('/')){
    path=join(path,part);
    try{if(lstatSync(path).isSymbolicLink())throw Error('Linked timeline path');}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(!inside(root,path))throw Error('Timeline path escapes root');
  return path;
}
function optional(root,name){try{return readFileSync(pathAt(root,name));}catch(error){if(error.code==='ENOENT')return null;throw error;}}

export function candidateTimelineManifest(original,kind,mapVersion,mapHash){
  if(!['daily','rental'].includes(kind)||original.schema!==3||original.regional?.kind!==kind||original.regional?.format!=='packed-region'
    ||typeof original.version!=='string'||!original.version||!original.sources||typeof mapVersion!=='string'||!mapVersion||!/^[a-f0-9]{64}$/.test(mapHash))throw Error('Packed timeline metadata is required');
  const value=structuredClone(original);value.mapVersion=mapVersion;
  if(Object.hasOwn(value.sources,'data/map/index.json')){
    value.sources['data/map/index.json']=mapHash;
    // This is a preview dependency version. The source revision and every fact
    // digest remain identical. Rental without a map dependency retains the
    // original version used by the contracts manifest.
    if(!isDeepStrictEqual(value.sources,original.sources))value.version=hash(JSON.stringify(['current-review-timeline-preview-v1',kind,original.version,mapVersion,mapHash]));
  }
  return value;
}

export function prepareCurrentReviewTimeline(baseline,candidate){
  baseline=checkedRoot(baseline);candidate=checkedRoot(candidate);
  if(!candidate.split(sep).includes('_ops')||same(baseline,candidate)||inside(baseline,candidate)||inside(candidate,baseline))throw Error('Timeline candidate must be separate and inside an _ops directory');
  const inputs=new Map(),read=(root,name)=>{const path=pathAt(root,name),bytes=readFileSync(path);inputs.set(path,bytes);return {bytes,value:JSON.parse(bytes)};};
  const marker=read(candidate,'manifest.json').value,mapInput=read(candidate,'data/map/index.json'),map=mapInput.value;
  if(marker.candidateOnly!==true||map.meta?.candidateOnly!==true||map.meta?.approvedOnly!==false||map.meta?.contract!=='current-review-publication-candidate-v1')throw Error('Explicit current review candidate required');
  const oldMap=read(baseline,'data/map/index.json');
  if(marker.identityBaseline?.files?.['data/map/index.json']?.sha256!==hash(oldMap.bytes))throw Error('Candidate identity baseline differs');
  if(!Array.isArray(map.d)||!Array.isArray(oldMap.value.d))throw Error('Map identity rows missing');
  const ids=new Set(map.d.map(c=>c.id));
  if(ids.has(undefined)||ids.size!==map.d.length||oldMap.value.d.some(c=>!ids.has(c.id)))throw Error('Timeline overlay requires preserved public map identities');
  const mapHash=hash(mapInput.bytes),mapVersion=map.meta.sourceVersion,plans=new Map(),manifests={};
  for(const kind of ['daily','rental']){
    const name=`data/${kind}/index.json`,before=read(baseline,name),after=candidateTimelineManifest(before.value,kind,mapVersion,mapHash);
    if(kind==='rental'&&after.version!==before.value.version)throw Error('Rental map dependency changes require matching contract metadata');
    if(kind==='daily'&&before.value.sources['data/map/index.json']!==hash(oldMap.bytes))throw Error('Baseline daily map source differs');
    const existing=optional(candidate,name);
    if(existing){inputs.set(pathAt(candidate,name),existing);const current=JSON.parse(existing);
      if(!isDeepStrictEqual(current,before.value)&&!isDeepStrictEqual(current,after))throw Error('Candidate timeline contains changes outside map bindings');}
    const bytes=Buffer.from(JSON.stringify(after));plans.set(name,bytes);
    manifests[kind]={before:hash(before.bytes),after:hash(bytes),version:after.version,sourceRevision:after.sourceRevision};
  }
  const searchName='data/search/apartments.json',searchBytes=optional(candidate,searchName);
  if(searchBytes){
    inputs.set(pathAt(candidate,searchName),searchBytes);const search=JSON.parse(searchBytes);
    if(search.schema!==1||search.candidateOnly!==true||!Array.isArray(search.apartments)||search.sources?.['data/map/index.json']!==mapHash
      ||search.version!==hash(JSON.stringify({schema:1,sources:search.sources,apartments:search.apartments})))throw Error('Candidate search is not bound to the current map');
    for(const kind of ['daily','rental']){const name=`data/${kind}/index.json`,proof=manifests[kind];
      if(![proof.before,proof.after].includes(search.sources[name]))throw Error('Candidate search timeline source differs');
      search.sources[name]=proof.after;
    }
    search.version=hash(JSON.stringify({schema:1,sources:search.sources,apartments:search.apartments}));plans.set(searchName,Buffer.from(JSON.stringify(search)));
  }
  // Validate every consumed metadata file before any candidate mutation.
  for(const[path,bytes]of inputs)if(!readFileSync(path).equals(bytes))throw Error('Timeline input changed');
  const written=[];
  for(const[name,bytes]of plans){
    const path=pathAt(candidate,name),existing=optional(candidate,name);if(existing?.equals(bytes))continue;
    mkdirSync(dirname(path),{recursive:true});const temp=path+'.'+randomUUID()+'.tmp';let created=false;
    try{writeFileSync(temp,bytes,{flag:'wx'});created=true;renameSync(temp,path);created=false;written.push(name);}
    finally{if(created)rmSync(temp);}
  }
  return {candidateOnly:true,mapVersion,mapHash,written,manifests,transactionFilesRead:0,transactionFilesWritten:0,baselineChanged:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==4)throw Error('Usage: node prepare-current-review-timeline.mjs BASELINE CANDIDATE');console.log(JSON.stringify(prepareCurrentReviewTimeline(process.argv[2],process.argv[3])));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
