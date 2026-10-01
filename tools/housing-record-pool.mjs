// Reuse region-local identifier pools only after checking current input and output bytes.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {regionalReader} from './regional-data.mjs';
import {partitionDependencies} from '../js/housing-partition.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function write(path,bytes){if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('Pool output link');if(existsSync(path)&&readFileSync(path).equals(Buffer.from(bytes)))return;const temp=path+'.'+process.pid+'.tmp';writeFileSync(temp,bytes);renameSync(temp,path);}
function safeDirectory(path){for(let p=resolve(path);;){if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('Pool directory link');const parent=resolve(p,'..');if(parent===p)break;p=parent;}mkdirSync(path,{recursive:true});}
export function rebuildRecordPools(site,output,{codes=null,full=process.env.NODO_FULL_VERIFY==='1',readers=null}={}){
 const started=performance.now(),d=readers?.daily??regionalReader(site,'daily'),r=readers?.rental??regionalReader(site,'rental');
 if(d.manifest.schema!==3||r.manifest.schema!==3)throw Error('Packed source required');
 const engine=hash(['./housing-record-pool.mjs','./regional-data.mjs','./housing-regional-reader.mjs','../js/regional-data.js','../js/housing-validation.mjs','../js/housing-quarter.mjs','../js/housing-facts.mjs','../js/housing-state-timeline.mjs','../js/housing-partition.mjs','../js/generated/housing-columns.mjs'].map(p=>hash(readFileSync(new URL(p,import.meta.url)))).join('|'));
 safeDirectory(output);const all={},metrics=[];
 for(const code of codes??[...d.table.regions.keys()].sort()){
  if(!/^\d{5}$/.test(code)||!d.table.regions.has(code)||!r.table.regions.has(code))throw Error('Unknown pool region');
  const begin=performance.now(),deps={},scope={};
  for(const[kind,reader]of [['daily',d],['rental',r]]){
   const identity=reader.table.regions.get(code).entry.identities,quarters=reader.manifest.regional.quarters[code]||{};
   scope[kind]=quarters;
   for(const path of new Set([identity,...Object.values(quarters).flatMap(p=>partitionDependencies(p,reader.manifest.sources))])){
    const actual=reader.physical(path,false).sha256;
    if(deps[path]&&deps[path]!==actual)throw Error('Pool shared input mismatch');deps[path]=actual;
   }
  }
  // No site-wide manifest version, metadata, map state, or collection timestamp.
  const proof=hash(JSON.stringify([scope,Object.entries(deps).sort((a,b)=>a[0].localeCompare(b[0],'en'))]));
  const directory=join(output,code),index=join(directory,'index.json'),receipt=join(directory,'reuse-proof.json');safeDirectory(directory);
  let files,reused=false,rebuiltQuarters=0,reusedQuarters=0,reason=full?'full':'missing';
  if(!full&&existsSync(receipt)){
   try{
    const saved=JSON.parse(readFileSync(receipt));reason=saved.engine!==engine?'engine':saved.proof!==proof?'inputs':'outputs';
    if(saved.engine===engine&&saved.proof===proof&&saved.indexSha256===hash(readFileSync(index))){
     const previous=JSON.parse(readFileSync(index));
     if(previous.proof===proof&&previous.files&&Object.entries(previous.files).every(([p,h])=>/^\d{4}-\d{2}-(daily|rental)\.bin$/.test(p)&&!lstatSync(join(directory,p)).isSymbolicLink()&&hash(readFileSync(join(directory,p)))===h)){files=previous.files;reused=true;reason='unchanged';}
    }
   }catch{reason='invalid-cache';}
  }
  if(!reused){
   files={};const quarterReceipt=join(directory,'quarter-reuse.json');let old={};
   if(!full&&existsSync(quarterReceipt)){try{const v=JSON.parse(readFileSync(quarterReceipt));if(v.engine===engine)old=v.quarters||{};}catch{}}
   const stamps={},months=[...new Set([...Object.keys(d.manifest.regional.quarters[code]||{}),...Object.keys(r.manifest.regional.quarters[code]||{})])].sort(),quarter=m=>m.slice(0,4)+'-Q'+Math.ceil(Number(m.slice(5))/3);
   for(const q of [...new Set(months.map(quarter))]){
    const qm=months.filter(m=>quarter(m)===q),paths=new Set();
    const mapping={};for(const[kind,reader]of [['daily',d],['rental',r]]){paths.add(reader.table.regions.get(code).entry.identities);mapping[kind]=qm.map(m=>[m,reader.manifest.regional.quarters[code]?.[m]??null]);for(const [,p]of mapping[kind])if(p)for(const dep of partitionDependencies(p,reader.manifest.sources))paths.add(dep);}
    const key=hash(JSON.stringify([mapping,[...paths].sort().map(p=>[p,deps[p]])])),prior=old[q];let part;
    const validQuarter=()=>{try{return prior?.key===key&&prior.files&&Object.entries(prior.files).every(([p,h])=>qm.some(m=>p===m+'-daily.bin'||p===m+'-rental.bin')&&!lstatSync(join(directory,p)).isSymbolicLink()&&hash(readFileSync(join(directory,p)))===h);}catch{return false;}};
    if(validQuarter()){part=prior.files;reusedQuarters++;}
    else{
     part={};rebuiltQuarters++;
     for(const[kind,reader]of [['daily',d],['rental',r]])for(const month of qm){if(!reader.manifest.regional.quarters[code]?.[month])continue;const rows=reader.regionMonth(code,month,false).rows.map(row=>[row.slice(0,kind==='daily'?5:8),row[kind==='daily'?10:17]]);if(!rows.length)continue;const name=`${month}-${kind}.bin`,bytes=gzipSync(JSON.stringify(rows),{level:6});write(join(directory,name),bytes);part[name]=hash(bytes);}
    }
    Object.assign(files,part);stamps[q]={key,files:part};
   }
   write(quarterReceipt,Buffer.from(JSON.stringify({engine,quarters:stamps})));
   write(index,Buffer.from(JSON.stringify({proof,files})));
   write(receipt,Buffer.from(JSON.stringify({engine,proof,indexSha256:hash(readFileSync(index))})));
  }
  all[code]=files;metrics.push({code,reused,reason,rebuiltQuarters,reusedQuarters,files:Object.keys(files).length,seconds:(performance.now()-begin)/1000});
 }
 for(const reader of[d,r])for(const[path,digest]of Object.entries(reader.inputs))if(reader.physical(path,false).sha256!==digest)throw Error('Packed pool source changed');
 const proof=hash(JSON.stringify(all));write(join(output,'index.json'),Buffer.from(JSON.stringify({proof,files:all})));
 return {status:'PASS',regions:metrics.length,reusedRegions:metrics.filter(m=>m.reused).length,rebuiltRegions:metrics.filter(m=>!m.reused).length,proof,seconds:(performance.now()-started)/1000,metrics};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const[site,output]=process.argv.slice(2);if(!site||!output)throw Error('SITE OUTPUT required');console.log(JSON.stringify(rebuildRecordPools(site,output)));}
