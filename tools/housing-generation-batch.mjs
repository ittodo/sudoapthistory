// Private candidate consumption, bound to DB batches and current producer manifests.
// No public schema change and no DB writes. Checkpoint is accepted by outer Rust prepare.
import{readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,lstatSync}from'node:fs';
import{join,resolve,dirname,sep}from'node:path';import{createHash}from'node:crypto';
import{codeDependencyEngine as validationEngine}from'./code-dependencies.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Dependency keys can contain exact integer mantissas from excluded sale facts.
// Encode every value with its type so bigint, decimal text and numbers cannot collide.
// Only the digest is persisted; transaction bytes and public identities stay unchanged.
function dependencyValue(value){
 const type=typeof value;
 if(value===null)return ['null'];
 if(type==='bigint')return ['bigint',value.toString()];
 if(type==='undefined')return ['undefined'];
 if(type==='string'||type==='boolean')return [type,value];
 if(type==='number'){if(!Number.isFinite(value))throw Error('Generation dependency finite number');return [type,Object.is(value,-0)?'-0':value];}
 if(Array.isArray(value))return ['array',value.map(dependencyValue)];
 if(type==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null))return ['object',Object.entries(value).map(([key,item])=>[key,dependencyValue(item)])];
 throw Error('Generation dependency key type');
}
const dependencyKey=value=>hash(JSON.stringify(dependencyValue(value)));

// Identity snapshots are shared privately; source arrays may still append during
// packaging. The on-disk dictionary stores exact values once, never renumbers them.
const identityStorage='dictionary-v1';
function validIdentity(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Generation identity dictionary');
 for(const[code,region]of Object.entries(value)){
  if(!/^\d{5}$/.test(code)||!region||typeof region!=='object'||Array.isArray(region)||Object.keys(region).some(k=>!['complexes','areas','source'].includes(k)))throw Error('Generation identity dictionary');
  if(!Array.isArray(region.complexes)||!Array.isArray(region.areas)||region.source!==undefined&&!Array.isArray(region.source))throw Error('Generation identity dictionary');
 }
 return value;
}
export function compactGenerationScopes(scopes){
 const identities={},compact={},memo=new WeakMap();let inlineBytes=0,storedBytes=0;
 for(const[name,scope]of Object.entries(scopes)){
  validIdentity(scope.identity);
  let entry=memo.get(scope.identity);
  if(!entry){const json=JSON.stringify(scope.identity);entry={id:hash(json),bytes:Buffer.byteLength(json)};memo.set(scope.identity,entry);if(!Object.hasOwn(identities,entry.id)){identities[entry.id]=scope.identity;storedBytes+=entry.bytes;}}
  const {identity,...rest}=scope;compact[name]={...rest,identityRef:entry.id};inlineBytes+=entry.bytes;
 }
 return {identityStorage,identities,scopes:compact,metrics:{identityDefinitions:Object.keys(identities).length,identityReferences:Object.keys(compact).length,identityBytesBefore:inlineBytes,identityBytesStored:storedBytes}};
}
function expandGenerationScopes(body,intern){
 if(body.identityStorage===undefined){
  if(body.identities!==undefined)throw Error('Generation identity storage format');
  return Object.fromEntries(Object.entries(body.scopes).map(([name,scope])=>{
   if(scope.identityRef!==undefined)throw Error('Generation identity reference without dictionary');
   return [name,{...scope,identity:intern(validIdentity(scope.identity))}];
  }));
 }
 if(body.identityStorage!==identityStorage||!body.identities||typeof body.identities!=='object'||Array.isArray(body.identities))throw Error('Generation identity storage format');
 const identities={};
 for(const[id,value]of Object.entries(body.identities)){
  if(!/^[a-f0-9]{64}$/.test(id)||hash(JSON.stringify(validIdentity(value)))!==id)throw Error('Generation identity dictionary digest');
  identities[id]=intern(value);
 }
 return Object.fromEntries(Object.entries(body.scopes).map(([name,scope])=>{
  if(scope.identity!==undefined||typeof scope.identityRef!=='string'||!Object.hasOwn(identities,scope.identityRef))throw Error('Generation identity reference missing');
  const {identityRef,...rest}=scope;return [name,{...rest,identity:identities[identityRef]}];
 }));
}
function identityFits(old,now){return Object.entries(old).every(([code,v])=>now[code]&&['complexes','areas','source'].every(k=>(v[k]||[]).every((x,i)=>eq(x,now[code][k]?.[i]))));}
function safe(root,path){if(!/^data\//.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..')||/[\\:]/.test(path))throw Error('Generation output path');let p=root;for(const part of path.split('/')){p=join(p,part);if(lstatSync(p).isSymbolicLink())throw Error('Generation artifact link');}if(realpathSync(p).toLowerCase()!==p.toLowerCase())throw Error('Generation artifact path');return p;}
export class GenerationFileSession{
 constructor({site,output,cache,batch,engine=null}){
  this.output=resolve(output);this.checkpoint=cache?join(resolve(cache),'generation-consumer.json'):null;this.batch=batch;this.old=null;this.scopes={};this.metrics={mode:'BASELINE',scopesReused:0,scopesBuilt:0,rawInputsSkipped:0,bytesReused:0,batchesConsumed:0};
  this.engine=engine??validationEngine(site,{roots:['tools/build-housing-from-native.mjs']});this.pending=null;this.identityPool=new Map();this.childrenByRegion=new Map();
  if(batch==null)return;
  if(batch.schema!==1||!Number.isSafeInteger(batch.seq)||batch.seq<0||typeof batch.revision!=='string'||!Array.isArray(batch.batches))throw Error('Invalid generation file snapshot');
  let seq=0,revision=null;
  for(const b of batch.batches){if(!Number.isSafeInteger(b.seq)||b.seq!==seq+1||hash(b.payload)!==b.digest)throw Error('Generation file batch chain/digest');const v=JSON.parse(b.payload);if(v.schema!==1||(revision!==null&&v.previousRevision!==revision))throw Error('Generation file batch revision');seq=b.seq;revision=v.revision;}
  if(seq!==batch.seq||(seq>0&&revision!==batch.revision))throw Error('Generation file batches not current');
  if(!this.checkpoint||!existsSync(this.checkpoint)||process.env.NODO_FULL_VERIFY==='1')return;
  if(lstatSync(this.checkpoint).isSymbolicLink())throw Error('Generation checkpoint link');
  const v=JSON.parse(readFileSync(this.checkpoint)),body=v.body;
  if(v.sha256!==hash(JSON.stringify(body))||body.schema!==1||body.status!=='CANDIDATE_VERIFIED'||!Number.isSafeInteger(body.seq)||body.seq<0||typeof body.revision!=='string'||!body.scopes||typeof body.scopes!=='object'||Array.isArray(body.scopes)||resolve(body.checkpoint)!==this.checkpoint)throw Error('Generation checkpoint corrupt');
  if(body.engine!==this.engine){this.metrics.mode='ENGINE_BASELINE';return;}
  if(body.seq>batch.seq)throw Error('Generation checkpoint ahead of operating DB');
  const after=batch.batches.filter(b=>b.seq>body.seq);let previous=body.revision,expected=body.seq;
  for(const b of after){const v=JSON.parse(b.payload);if(b.seq!==++expected||v.previousRevision!==previous)throw Error('Generation consumption gap');if(v.complete!==true){this.metrics.mode='INCOMPLETE_BASELINE';return;}previous=v.revision;}
  if(previous!==batch.revision)throw Error('Generation consumption revision missing');
  // The stored cursor itself must remain in the retained DB chain.
  if(body.seq>0&&JSON.parse(batch.batches.find(b=>b.seq===body.seq)?.payload??'null')?.revision!==body.revision)throw Error('Generation checkpoint cursor mismatch');
  this.old={...body,scopes:expandGenerationScopes(body,v=>this.internIdentity(v))};
  for(const[name,scope]of Object.entries(this.old.scopes)){const [kind,code]=name.split('/');if(['year','quarter','state-year'].includes(kind)){if(!this.childrenByRegion.has(code))this.childrenByRegion.set(code,[]);this.childrenByRegion.get(code).push([name,scope]);}}
  this.metrics.mode='INCREMENTAL';this.metrics.batchesConsumed=after.length;
 }
 internIdentity(identity){
  const serialized=JSON.stringify(validIdentity(identity)),id=hash(serialized);
  if(!this.identityPool.has(id))this.identityPool.set(id,structuredClone(identity));
  return this.identityPool.get(id);
 }
 peek(scope){return this.old?.scopes?.[scope]??null;}
 load(scope,key,identity,allowed,emit){
  const prior=this.peek(scope);if(!prior||prior.key!==dependencyKey(key)||!identityFits(prior.identity,identity))return null;
  const root=realpathSync(this.old.output);
  if(root===this.output||this.output.startsWith(root+sep)||root.startsWith(this.output+sep))throw Error('Generation output overlap');
  const assets=[];for(const[path,r]of Object.entries(prior.files)){if(!allowed(path))throw Error('Generation scope inventory');const p=safe(root,path);if(lstatSync(p).size>25*1024*1024)throw Error('Generation cached file size');const bytes=readFileSync(p);if(bytes.length!==r.bytes||hash(bytes)!==r.sha256)throw Error('Generation cached output changed');assets.push([path,bytes]);}
  for(const[p,b]of assets){emit(p,b);this.metrics.bytesReused+=b.length;}this.scopes[scope]=prior;
  // A verified containing scope also carries its unchanged finer receipts forward.
  const parts=scope.split('/'),contains=name=>{const n=name.split('/');return parts[0]==='region'&&n[1]===parts[1]&&['year','quarter','state-year'].includes(n[0])||parts[0]==='year'&&n[1]===parts[1]&&(n[0]==='state-year'&&n[2]===parts[2]||n[0]==='quarter'&&n[2].startsWith(parts[2]+'-Q'));};
  const fits=new Map([[prior.identity,true]]),identityCompatible=value=>{if(!fits.has(value))fits.set(value,identityFits(value,identity));return fits.get(value);};
  if(['region','year'].includes(parts[0]))for(const[name,child]of this.childrenByRegion.get(parts[1])||[])if(contains(name)&&identityCompatible(child.identity)&&Object.entries(child.files).every(([p,r])=>eq(prior.files[p],r)))this.scopes[name]=child;
  this.metrics.scopesReused++;return prior.result;
 }
 save(scope,key,identity,result,paths){
  const files={};for(const path of paths){const b=readFileSync(safe(this.output,path));files[path]={bytes:b.length,sha256:hash(b)};}
  this.scopes[scope]={key:dependencyKey(key),identity:this.internIdentity(identity),result,files};this.metrics.scopesBuilt++;
 }
 finish(){
  if(!this.checkpoint||this.batch==null)return {status:'NOT_RUN',...this.metrics};
  mkdirSync(dirname(this.checkpoint),{recursive:true});
  const compact=compactGenerationScopes(this.scopes);Object.assign(this.metrics,compact.metrics);
  const body={schema:1,status:'CANDIDATE_VERIFIED',engine:this.engine,checkpoint:this.checkpoint,output:realpathSync(this.output),seq:this.batch.seq,revision:this.batch.revision,identityStorage:compact.identityStorage,identities:compact.identities,scopes:compact.scopes};
  this.pending=join(this.output,'generation-consumption.pending.json');writeFileSync(this.pending,JSON.stringify({body,sha256:hash(JSON.stringify(body))}));
  return {status:'PENDING_OUTER_VALIDATION',pending:this.pending,seq:body.seq,revision:body.revision,engine:this.engine,...this.metrics};
 }
}
