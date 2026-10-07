// Successful local detail-generation receipts; outputs are always verified before reuse.
import{readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,lstatSync,renameSync}from'node:fs';
import{join,resolve}from'node:path';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
import{partitionDependencies}from'../js/housing-partition.mjs';import{codeDependencyEngine as validationEngine}from'./code-dependencies.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function detailEngine(name){return validationEngine(fileURLToPath(new URL('../',import.meta.url)),{roots:['tools/'+name]});}
export function detailDependencies(reader,code,months){
 const result={};for(const month of months){const path=reader.manifest.regional.quarters?.[code]?.[month];if(path)for(const p of partitionDependencies(path,reader.manifest.sources)){reader.physical(p,false);result[p]=reader.manifest.sources[p];}}
 return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b,'en')));
}
export function detailIdentity(table,codes){return Object.fromEntries(codes.map(code=>{const r=table.regions.get(code);return[code,{complexes:r.identity.complexes,areas:r.identity.areas,source:r.identity.complexes.map((_,i)=>[table.complexes[code+':'+i]?.id,table.complexes[code+':'+i]?.hasSale??null])}];}));}
function compatible(old,current){return Object.entries(old).every(([code,v])=>current[code]&&['complexes','areas','source'].every(k=>v[k].every((a,i)=>equal(a,current[code][k][i]))));}
export function detailMemo(directory,key,identity,allowed,make){
 const digest=hash(JSON.stringify(key)),target=directory?join(resolve(directory),'details',digest):null;
 function safe(p){if(lstatSync(p).isSymbolicLink()||realpathSync(p).toLowerCase()!==p.toLowerCase())throw Error('Detail cache link');}
 if(target&&process.env.NODO_FULL_VERIFY!=='1'&&existsSync(join(target,'receipt.json'))){
  safe(target);safe(join(target,'receipt.json'));const r=JSON.parse(readFileSync(join(target,'receipt.json'))),b=r.body;
  if(b.schema!==1||b.key!==digest||b.status!=='PASS'||r.sha256!==hash(JSON.stringify(b)))throw Error('Detail cache receipt mismatch');
  if(compatible(b.identity,identity)){
   const files=new Map();for(const[p,v]of Object.entries(b.files)){if(!allowed(p)||!/^\d+\.bin$/.test(v.file))throw Error('Detail cache scope');const file=join(target,v.file);safe(file);if(lstatSync(file).size>25*1024*1024)throw Error('Detail cache size');const bytes=readFileSync(file);if(bytes.length!==v.bytes||hash(bytes)!==v.sha256)throw Error('Detail cache bytes changed');files.set(p,bytes);}
   return{result:b.result,files,reused:true};
  }
 }
 const value=make();for(const p of value.files.keys())if(!allowed(p))throw Error('Detail output scope');
 if(target){mkdirSync(target,{recursive:true});safe(target);const files={};let n=0;
  for(const[p,bytes]of value.files){const file=(n++)+'.bin',dest=join(target,file);if(existsSync(dest))safe(dest);writeFileSync(dest,bytes);files[p]={file,bytes:bytes.length,sha256:hash(bytes)};}
  const body={schema:1,key:digest,status:'PASS',identity,result:value.result,files},temp=join(target,'receipt.'+process.pid+'.tmp');writeFileSync(temp,JSON.stringify({body,sha256:hash(JSON.stringify(body))}));renameSync(temp,join(target,'receipt.json'));
 }
 return{...value,reused:false};
}
