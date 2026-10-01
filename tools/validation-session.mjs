import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import {join,resolve,dirname,sep} from 'node:path';
const digest = x => createHash('sha256').update(x).digest('hex');
// Receipts are an optimization of successful checks, never an alternative to
// verifying current inputs. The engine key includes every local reader/model.
export function fullValidationEngine(root) {
 const files=[];
 function walk(directory,prefix){if(!existsSync(directory))return;for(const entry of readdirSync(directory,{withFileTypes:true})){
  const path=join(directory,entry.name),name=prefix+entry.name;
  if(lstatSync(path).isSymbolicLink())throw Error('Validation engine symlink');
  if(entry.isDirectory()){if(!['target','node_modules','dist','.git','.cache'].includes(entry.name))walk(path,name+'/');}else if(/\.(?:m?js|cjs|json)$/.test(name))files.push([name,digest(readFileSync(path))]);
 }}
 for(const name of ['tools','js'])walk(join(root,name),name+'/');
 return digest(JSON.stringify(files.sort((a,b)=>a[0].localeCompare(b[0],'en'))));
}
// The producer and semantic checks share one conservative dependency closure.
// Unknown dynamic imports fall back to the previous full tools/js fingerprint.
const validationRoots=['tools/validation-session.mjs','tools/data-validation-proof.mjs','tools/verify-housing-regions.mjs','tools/verify-housing-sales.mjs','tools/verify-housing-details.mjs','tools/verify-apartment-sale.mjs','tools/verify-apartment-rent.mjs','tools/verify-daily-data.mjs','tools/verify-rental-data.mjs'];
export function validationEngine(root,{roots=validationRoots}={}) {
 root=resolve(root);const files=new Map();
 try {
  function visit(path){path=resolve(path);if(!path.startsWith(root+sep)||lstatSync(path).isSymbolicLink()||realpathSync(path).toLowerCase()!==path.toLowerCase())throw Error('Unsafe engine dependency');const name=path.slice(root.length+1).replaceAll('\\','/');if(files.has(name))return;
   const bytes=readFileSync(path),source=bytes.toString();files.set(name,digest(bytes));
   if(/\b(?:import|require)\s*\(\s*[^'"\s]/.test(source))throw Error('Dynamic validation dependency');
   for(const match of source.matchAll(/['"](\.{1,2}\/[^'"\n]+\.(?:m?js|cjs|json))['"]/g))visit(resolve(dirname(path),match[1]));
  }
  for(const name of roots)visit(join(root,name));
  return digest(JSON.stringify({schema:2,files:[...files].sort((a,b)=>a[0].localeCompare(b[0],'en'))}));
 } catch {return fullValidationEngine(root);}
}
export class ValidationSession {
 constructor(root,{directory=process.env.NODO_VALIDATION_CACHE_DIR??join(root,'cloudflare/dist/validation-cache-v1'),full=process.env.NODO_FULL_VERIFY==='1',engine}={}) {
  this.root=resolve(root);this.directory=resolve(directory);this.full=full;this.engine=engine??validationEngine(this.root);this.records={};this.stats={checked:0,reused:0};this.misses={full:0,missing:0,inputs:0,invalid:0};this.cacheStatus='missing';
  let current=this.directory;for(;;){if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('Validation cache symlink');const parent=resolve(current,'..');if(parent===current)break;current=parent;}
  this.file=join(this.directory,'receipts.json');
  try {const stored=JSON.parse(readFileSync(this.file));this.cacheStatus=stored.engine!==this.engine?'engine':stored.schema!==1||digest(JSON.stringify(stored.records))!==stored.digest?'invalid':'ready';if(this.cacheStatus==='ready')this.records=stored.records;}catch{if(existsSync(this.file))this.cacheStatus='invalid';}
 }
 check(scope,inputs,verify){
  const entries=Object.entries(inputs).sort((a,b)=>a[0].localeCompare(b[0],'en'));
  const key=digest(JSON.stringify([this.engine,scope,entries]));const previous=this.records[scope];
  if(!this.full&&previous?.key===key&&previous.status==='PASS'&&previous.result!==undefined){this.stats.reused++;return previous.result;}
  this.misses[this.full?'full':!previous?'missing':previous.key!==key?'inputs':'invalid']++;
  const result=verify();if(result?.status&&result.status!=='PASS')throw Error('Validation did not PASS: '+scope);
  this.records[scope]={key,status:'PASS',result:result??null};this.stats.checked++;return result;
 }
 flush(){
  // Other checks in this same process can add scopes after this session opens.
  try{const stored=JSON.parse(readFileSync(this.file));if(stored.schema===1&&stored.engine===this.engine&&digest(JSON.stringify(stored.records))===stored.digest)this.records={...stored.records,...this.records};}catch{}
  mkdirSync(this.directory,{recursive:true});const target=this.file+'.'+process.pid+'.tmp';writeFileSync(target,JSON.stringify({schema:1,engine:this.engine,records:this.records,digest:digest(JSON.stringify(this.records))}));renameSync(target,this.file);
 }
}
export function manifestDependencies(root,names){
 const inputs={};
 for(const name of names){const bytes=readFileSync(join(root,name));inputs[name]=digest(bytes);const manifest=JSON.parse(bytes);
  for(const [path,expected] of [...Object.entries(manifest.sources??{}),...Object.entries(manifest.shards??{})]){
   if(!/^data\//.test(path)||path.split('/').some(p=>!p||p==='..'||p==='.')||/[\\:]/.test(path))throw Error('Unsafe validation dependency');
   let target=root;for(const part of path.split('/')){target=join(target,part);if(lstatSync(target).isSymbolicLink())throw Error('Validation source symlink');}
   const actual=digest(readFileSync(target));if(actual!==expected)throw Error('Validation source mismatch: '+path);if(inputs[path]&&inputs[path]!==actual)throw Error('Shared validation digest mismatch');inputs[path]=actual;
  }
 }
 return inputs;
}
