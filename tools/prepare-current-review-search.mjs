// Candidate-only search metadata. The production approvedOnly gate stays intact.
import {readFileSync,writeFileSync,lstatSync,realpathSync,mkdirSync,renameSync,rmSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,sep,parse,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {regionalReader} from './regional-reader.mjs';
import {combineCatalogs,markUnlocatedPublications} from './build-search-data.mjs';
import {mapBoundarySources} from './map-boundary-metadata.mjs';
import {candidateTimelineManifest} from './prepare-current-review-timeline.mjs';
import {isDeepStrictEqual} from 'node:util';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(root,path)=>{const r=relative(root,path);return r!==''&&!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r);};
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function checkedRoot(value){
  const root=resolve(value);let path=parse(root).root;
  for(const part of relative(path,root).split(sep).filter(Boolean)){
    path=join(path,part);if(lstatSync(path).isSymbolicLink())throw Error('Search root cannot use a symbolic link or junction');
  }
  if(!lstatSync(root).isDirectory()||!same(root,realpathSync(root)))throw Error('Invalid search root');
  return root;
}
function pathAt(root,name,{missing=false}={}){
  if(!name||name.split('/').some(p=>!p||p==='.'||p==='..'||/[\\:]/.test(p)))throw Error('Invalid search source path');
  let path=root;
  for(const part of name.split('/')){
    path=join(path,part);
    try{if(lstatSync(path).isSymbolicLink())throw Error('Linked search path');}
    catch(error){if(error.code==='ENOENT'&&missing)continue;throw error;}
  }
  if(!inside(root,path))throw Error('Search path escapes root');
  return path;
}
function optionalBytes(root,name){
  try{return readFileSync(pathAt(root,name));}catch(error){if(error.code==='ENOENT')return null;throw error;}
}

export function prepareCurrentReviewSearch(baseline,candidate){
  baseline=checkedRoot(baseline);candidate=checkedRoot(candidate);
  if(!candidate.split(sep).includes('_ops')||same(baseline,candidate)||inside(baseline,candidate)||inside(candidate,baseline))throw Error('Search candidate must be separate and inside an _ops directory');
  const marker=JSON.parse(readFileSync(pathAt(candidate,'manifest.json')));
  if(marker.candidateOnly!==true)throw Error('An explicit candidateOnly manifest is required');
  const sources={},candidateInputs=new Map();
  const readCandidate=name=>{
    const bytes=readFileSync(pathAt(candidate,name));sources[name]=hash(bytes);candidateInputs.set(name,bytes);
    return JSON.parse(bytes);
  };
  const index=readCandidate('data/index.json'),identities=readCandidate('data/apartments/index.json'),
    map=readCandidate('data/map/index.json'),housing=readCandidate('data/housing-v3/index.json');
  if(housing.meta?.candidateOnly!==true||housing.meta?.approvedOnly!==false)throw Error('Unapproved candidate housing metadata is required');
  if(identities.version!==2||!identities.lookup||!Array.isArray(index.d)||!Array.isArray(map.d)||!Array.isArray(housing.complexes))throw Error('Incomplete candidate search inputs');
  for(const[name,expected]of Object.entries(mapBoundarySources(map))){
    const bytes=readFileSync(pathAt(candidate,name));if(hash(bytes)!==expected)throw Error('Candidate map boundary source mismatch: '+name);
    sources[name]=expected;candidateInputs.set(name,bytes);
  }
  const catalogInputs=new Map();
  const readers={};
  for(const kind of ['daily','rental']){
    // No regionMonth/read call: only existing identities and metadata are loaded.
    const manifestPath=`data/${kind}/index.json`,manifestBytes=readFileSync(pathAt(baseline,manifestPath));
    const reader=regionalReader(baseline,kind,{verifyOnce:true});
    if(reader.manifest.schema!==3)throw Error('Packed baseline catalogs are required');
    catalogInputs.set(manifestPath,hash(manifestBytes));
    for(const[name,digest]of Object.entries(reader.inputs)){
      if(catalogInputs.has(name)&&catalogInputs.get(name)!==digest)throw Error('Conflicting baseline catalog source: '+name);
      catalogInputs.set(name,digest);
    }
    readers[kind]=reader;
  }
  // The preview serves candidate data first. Hashes must describe those exact
  // bytes, even for shared catalogs read from the baseline.
  const servedInputs=new Map();
  for(const[name,digest]of catalogInputs){
    const bytes=optionalBytes(candidate,name)??readFileSync(pathAt(baseline,name));
    if(hash(bytes)!==digest){
      const kind=/^data\/(daily|rental)\/index\.json$/.exec(name)?.[1];
      const original=kind?JSON.parse(readFileSync(pathAt(baseline,name))):null;
      if(!kind||map.meta?.candidateOnly!==true||!isDeepStrictEqual(JSON.parse(bytes),candidateTimelineManifest(original,kind,map.meta.sourceVersion,sources['data/map/index.json'])))throw Error('Candidate overlay changes a baseline catalog input: '+name);
    }
    sources[name]=hash(bytes);servedInputs.set(name,sources[name]);
  }
  const apartments=combineCatalogs({
    sale:readers.daily.table.complexes.filter(c=>c.hasSale!==false),
    rental:readers.rental.table.complexes.filter(c=>c.hasRental!==false),
    rows:index.d,map:map.d,metadata:housing.complexes,lookup:identities.lookup,ambiguous:identities.ambiguous||[]
  });
  const unknownLocationEntries=markUnlocatedPublications(apartments,housing.complexes);
  const invalid=apartments.filter(c=>!c.id||!c.name||(![0,1,2].includes(c.r)&&!(c.r===null&&c.locationUnresolved))||!c.g||/^\d{5}$/.test(c.g));
  if(!apartments.length||invalid.length)throw Error('Invalid candidate search catalog: '+JSON.stringify(invalid.slice(0,5).map(c=>({id:c.id,name:c.name,r:c.r,g:c.g}))));
  const payload={schema:1,candidateOnly:true,version:hash(JSON.stringify({schema:1,sources,apartments})),sources,apartments};
  const bytes=Buffer.from(JSON.stringify(payload)),name='data/search/apartments.json';
  // Recheck only consumed metadata before writing the candidate output.
  for(const[path,input]of candidateInputs)if(!readFileSync(pathAt(candidate,path)).equals(input))throw Error('Candidate search input changed: '+path);
  for(const[path,digest]of catalogInputs){
    if(hash(readFileSync(pathAt(baseline,path)))!==digest)throw Error('Baseline search catalog input changed: '+path);
    const served=optionalBytes(candidate,path)??readFileSync(pathAt(baseline,path));
    if(hash(served)!==servedInputs.get(path))throw Error('Search catalog input changed: '+path);
  }
  const output=pathAt(candidate,name,{missing:true});mkdirSync(dirname(output),{recursive:true});
  const existing=optionalBytes(candidate,name);
  let written=false;
  if(!existing?.equals(bytes)){
    const temp=output+'.'+randomUUID()+'.tmp';let created=false;
    try{writeFileSync(temp,bytes,{flag:'wx'});created=true;renameSync(temp,output);created=false;written=true;}
    finally{if(created)rmSync(temp);}
  }
  return {candidateOnly:true,path:name,apartments:apartments.length,bytes:bytes.length,sha256:hash(bytes),version:payload.version,
    written,catalogFilesRead:catalogInputs.size,transactionFilesRead:0,unknownLocationEntries,sources};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==4)throw Error('Usage: node prepare-current-review-search.mjs BASELINE CANDIDATE');
    const {sources,...report}=prepareCurrentReviewSearch(process.argv[2],process.argv[3]);
    console.log(JSON.stringify(report));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
