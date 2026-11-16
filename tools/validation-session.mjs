import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,readdirSync,renameSync,writeFileSync} from './cache-store.mjs';
import {join,resolve,dirname,sep} from 'node:path';
import {readHashed,hashFile,fileSignature} from './file-hash-memo.mjs';
const digest = x => createHash('sha256').update(x).digest('hex');
// Receipts are an optimization of successful checks, never an alternative to
// verifying current inputs. The engine key includes every local reader/model.
import {codeDependencyEngine,fullValidationEngine} from './code-dependencies.mjs';
export {fullValidationEngine};
// The producer and semantic checks share one conservative dependency closure.
// Unknown dynamic imports fall back to the previous full tools/js fingerprint.
const validationRoots=['tools/validation-session.mjs','tools/data-validation-proof.mjs','tools/verify-housing-regions.mjs','tools/verify-housing-sales.mjs','tools/verify-housing-details.mjs','tools/verify-apartment-sale.mjs','tools/verify-apartment-rent.mjs','tools/verify-daily-data.mjs','tools/verify-rental-data.mjs'];
export function validationEngine(root,{roots=validationRoots}={}) {return codeDependencyEngine(root,{roots});}
// Schema 2 stores identity tables as a separate prefix condition.
const schema=2;
const prefixes=new WeakMap();
function prefixHash(value,nc,na){
 let cache=prefixes.get(value);if(!cache){cache=new Map();prefixes.set(value,cache);}
 const id=nc+':'+na;if(!cache.has(id))cache.set(id,digest(JSON.stringify([value.complexes.slice(0,nc),value.areas.slice(0,na)])));return cache.get(id);
}
function identityConditions(identities,inputs){
 const list=[...identities].sort((a,b)=>a.path.localeCompare(b.path,'en'));
 for(const [i,{path,value}]of list.entries()){
  if(typeof path!=='string'||!path||!Array.isArray(value?.complexes)||!Array.isArray(value?.areas))throw Error('Invalid identity condition');
  if(i&&list[i-1].path===path)throw Error('Duplicate identity condition');
  if(Object.hasOwn(inputs,path))throw Error('Identity file must not also be a receipt input: '+path);
 }
 return list;
}
function identityMatches(stored,current){
 if(!current)return stored===undefined;
 if(!Array.isArray(stored)||stored.length!==current.length)return false;
 return current.every(({path,value},i)=>{const s=stored[i];return s?.path===path&&Number.isSafeInteger(s.nc)&&Number.isSafeInteger(s.na)&&s.nc>=0&&s.na>=0&&value.complexes.length>=s.nc&&value.areas.length>=s.na&&typeof s.prefixHash==='string'&&prefixHash(value,s.nc,s.na)===s.prefixHash;});
}
export class ValidationSession {
 constructor(root,{directory=process.env.NODO_VALIDATION_CACHE_DIR??join(root,'cloudflare/dist/validation-cache-v1'),full=process.env.NODO_FULL_VERIFY==='1',engine,roots}={}) {
  this.root=resolve(root);this.directory=resolve(directory);this.full=full;this.engine=engine??validationEngine(this.root,roots?{roots}:{});this.records={};this.stats={checked:0,reused:0};this.misses={full:0,missing:0,inputs:0,identity:0,invalid:0};this.cacheStatus='missing';
  let current=this.directory;for(;;){if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('Validation cache symlink');const parent=dirname(current);if(parent===current)break;current=parent;}
  this.file=join(this.directory,roots?'receipts-'+this.engine+'.json':'receipts.json');
  try {const stored=JSON.parse(readFileSync(this.file));this.cacheStatus=stored.engine!==this.engine?'engine':stored.schema!==schema||digest(JSON.stringify(stored.records))!==stored.digest?'invalid':'ready';if(this.cacheStatus==='ready')this.records=stored.records;}catch{if(existsSync(this.file))this.cacheStatus='invalid';}
 }
 // identities: [{path,value:{complexes,areas}}] for append-only identity tables.
 // The caller has already checked each identity file against its manifest hash.
 // A receipt is reused only if the recorded prefix is unchanged; appended
 // complexes/areas are allowed because packed fact checks only look up numbers.
 check(scope,inputs,verify,{identities=null}={}){
  const entries=Object.entries(inputs).sort((a,b)=>a[0].localeCompare(b[0],'en'));
  const current=identities?identityConditions(identities,inputs):null;
  const key=digest(JSON.stringify([this.engine,scope,entries,current?current.map(c=>c.path):null]));const previous=this.records[scope];
  const passed=previous?.key===key&&previous.status==='PASS'&&previous.result!==undefined,identityOk=passed&&identityMatches(previous.identities,current);
  if(!this.full&&passed&&identityOk){this.stats.reused++;return previous.result;}
  this.misses[this.full?'full':!previous?'missing':previous.key!==key?'inputs':passed?'identity':'invalid']++;
  const result=verify();if(result?.status&&result.status!=='PASS')throw Error('Validation did not PASS: '+scope);
  const record={key,status:'PASS',result:result??null};
  if(current)record.identities=current.map(({path,value})=>({path,nc:value.complexes.length,na:value.areas.length,prefixHash:prefixHash(value,value.complexes.length,value.areas.length)}));
  this.records[scope]=record;this.stats.checked++;return result;
 }
 flush(){
  // Other checks in this same process can add scopes after this session opens.
  try{const stored=JSON.parse(readFileSync(this.file));if(stored.schema===schema&&stored.engine===this.engine&&digest(JSON.stringify(stored.records))===stored.digest)this.records={...stored.records,...this.records};}catch{}
  mkdirSync(this.directory,{recursive:true});const target=this.file+'.'+process.pid+'.tmp';writeFileSync(target,JSON.stringify({schema,engine:this.engine,records:this.records,digest:digest(JSON.stringify(this.records))}));renameSync(target,this.file);
 }
}
// This cache lives only for one call. Every distinct dependency is read from
// disk, hashed, and checked for mutation; no persistent proof is promoted.
export function manifestDependencies(root,names,{stats={}}={}){
 root=resolve(root);const inputs={},files=new Map(),directories=new Map(),manifests=new Set(names);
 Object.assign(stats,{references:0,reads:0,reused:0,bytes:0});
 const identity=s=>[s.dev,s.ino,s.mode].join(':');
 const signature=s=>[identity(s),s.size,s.mtimeNs,s.ctimeNs].join(':');
 function targetFor(path){
  if(!/^data\//.test(path)||path.split('/').some(p=>!p||p==='..'||p==='.')||/[\\:]/.test(path))throw Error('Unsafe validation dependency');
  let target=root;
  for(const part of path.split('/').slice(0,-1)){
   target=join(target,part);
   if(!directories.has(target)){
    const state=lstatSync(target,{bigint:true});
    if(state.isSymbolicLink()||!state.isDirectory())throw Error('Validation source symlink or non-directory');
    directories.set(target,identity(state));
   }
  }
  return join(root,path);
 }
 function read(path){
  stats.references++;const target=targetFor(path),previous=files.get(path);
  if(previous){stats.reused++;return previous;}
  const before=lstatSync(target,{bigint:true});
  if(before.isSymbolicLink()||!before.isFile())throw Error('Validation source symlink or non-file');
  // The process-scoped memo can supply the digest; the signatures still match here.
  const hashed=manifests.has(path)?readHashed(target):hashFile(target),after=lstatSync(target,{bigint:true});
  if(signature(before)!==signature(after)||hashed.signature!==fileSignature(after)||BigInt(hashed.size)!==after.size)throw Error('Validation source changed during reading: '+path);
  const value={target,signature:signature(after),digest:hashed.digest};
  if(manifests.has(path))value.manifest=JSON.parse(hashed.bytes);
  files.set(path,value);stats.reads++;stats.bytes+=hashed.size;return value;
 }
 for(const name of names){
  const value=read(name);
  inputs[name]=value.digest;
  for(const [path,expected] of [...Object.entries(value.manifest.sources??{}),...Object.entries(value.manifest.shards??{}),...Object.entries(value.manifest.contractArchive?.sources??{})]){
   const actual=read(path).digest;
   if(actual!==expected)throw Error('Validation source mismatch: '+path);
   if(inputs[path]&&inputs[path]!==actual)throw Error('Shared validation digest mismatch');
   inputs[path]=actual;
  }
 }
 // Recheck every identity after the complete traversal, including cached paths.
 for(const [target,expected] of directories){const state=lstatSync(target,{bigint:true});if(state.isSymbolicLink()||!state.isDirectory()||identity(state)!==expected)throw Error('Validation source directory changed');}
 for(const [path,value] of files){const state=lstatSync(value.target,{bigint:true});if(state.isSymbolicLink()||!state.isFile()||signature(state)!==value.signature)throw Error('Validation source changed during validation: '+path);}
 return inputs;
}
