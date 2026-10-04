// Bounded, same-run byte checks for private identifier pools; no stored PASS receipt.
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
function signature(path){const s=lstatSync(path,{bigint:true});if(!s.isFile()||s.isSymbolicLink())throw Error('Pool file type');return [s.size,s.mtimeNs,s.ctimeNs,s.ino].join('|');}
function inspect(root,row){
 const [code,name,digest]=row;const key=code+'/'+name;
 try{
  if(!/^\d{5}$/.test(code)||!/^\d{4}-\d{2}-(daily|rental)\.bin$/.test(name)||!(/^[0-9a-f]{64}$/).test(digest))throw Error('Pool verification request');
  const directory=join(root,code),path=join(directory,name);
  if(lstatSync(directory).isSymbolicLink()||!realpathSync(path).startsWith(root+sep))throw Error('Pool source link');
  const before=signature(path),actual=hash(readFileSync(path)),after=signature(path);
  return [key,{valid:before===after&&actual===digest,signature:after,digest:actual}];
 }catch{return [key,{valid:false}];}
}
if(!isMainThread){parentPort.postMessage(workerData.rows.map(r=>inspect(workerData.root,r)));}
export async function verifyPoolFiles(output,rows,{threads=4}={}){
 if(!isMainThread)throw Error('Main-thread verifier required');
 if(!Number.isInteger(threads)||threads<1||threads>4)throw Error('Pool verifier concurrency');
 const root=realpathSync(resolve(output));if(lstatSync(resolve(output)).isSymbolicLink())throw Error('Pool output link');
 const keys=new Set();for(const [code,name]of rows){const key=code+'/'+name;if(keys.has(key))throw Error('Duplicate pool verification path');keys.add(key);}
 const lanes=Array.from({length:Math.min(threads,rows.length)},()=>[]);
 rows.forEach((row,n)=>lanes[n%lanes.length].push(row));
 const result=await Promise.all(lanes.map(rows=>new Promise((resolve,reject)=>{
  const worker=new Worker(new URL(import.meta.url),{workerData:{root,rows},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16}});let replied=false;
  worker.once('message',v=>{replied=true;resolve(v);});worker.once('error',reject);
  worker.once('exit',code=>{if(code!==0||!replied)reject(Error('Pool verifier worker failed'));});
 })));
 const checks=new Map(result.flat());
 return {files:rows.length,threads:lanes.length,
  valid(code,name,digest){const proof=checks.get(code+'/'+name);if(!proof?.valid||proof.digest!==digest)return false;
   try{return signature(join(root,code,name))===proof.signature;}catch{return false;}
  }};
}
