import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const digest = x => createHash('sha256').update(x).digest('hex');
// Receipts are an optimization of successful checks, never an alternative to
// verifying current inputs. The engine key includes every local reader/model.
export function validationEngine(root) {
 const files=[];
 function walk(directory,prefix){if(!existsSync(directory))return;for(const entry of readdirSync(directory,{withFileTypes:true})){
  const path=join(directory,entry.name),name=prefix+entry.name;
  if(lstatSync(path).isSymbolicLink())throw Error('Validation engine symlink');
  if(entry.isDirectory()){if(!['target','node_modules','dist','.git','.cache'].includes(entry.name))walk(path,name+'/');}else if(/\.(?:m?js|cjs|json)$/.test(name))files.push([name,digest(readFileSync(path))]);
 }}
 for(const name of ['tools','js'])walk(join(root,name),name+'/');
 return digest(JSON.stringify(files.sort((a,b)=>a[0].localeCompare(b[0],'en'))));
}
export class ValidationSession {
 constructor(root,{directory=process.env.NODO_VALIDATION_CACHE_DIR??join(root,'cloudflare/dist/validation-cache-v1'),full=process.env.NODO_FULL_VERIFY==='1',engine}={}) {
  this.root=resolve(root);this.directory=resolve(directory);this.full=full;this.engine=engine??validationEngine(this.root);this.records={};this.stats={checked:0,reused:0};
  let current=this.directory;for(;;){if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('Validation cache symlink');const parent=resolve(current,'..');if(parent===current)break;current=parent;}
  this.file=join(this.directory,'receipts.json');
  try {const stored=JSON.parse(readFileSync(this.file));if(stored.schema===1&&stored.engine===this.engine&&digest(JSON.stringify(stored.records))===stored.digest)this.records=stored.records;}catch{}
 }
 check(scope,inputs,verify){
  const entries=Object.entries(inputs).sort((a,b)=>a[0].localeCompare(b[0],'en'));
  const key=digest(JSON.stringify([this.engine,scope,entries]));const previous=this.records[scope];
  if(!this.full&&previous?.key===key&&previous.status==='PASS'&&previous.result!==undefined){this.stats.reused++;return previous.result;}
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
