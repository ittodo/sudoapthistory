import{readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,renameSync}from'node:fs';import{join,resolve}from'node:path';import{createHash}from'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function packedMemo(cacheDir,key,make,validate,emit){
 const target=cacheDir?join(resolve(cacheDir),hash(JSON.stringify(key))):null;let result,files=new Map(),reused=false;
 if(target&&process.env.NODO_FULL_VERIFY!=='1'&&existsSync(join(target,'receipt.json'))){const receipt=JSON.parse(readFileSync(join(target,'receipt.json')));if(receipt.schema!==1)throw Error('Packing cache schema');result=receipt.result;
  for(const[p,entry]of Object.entries(receipt.files)){if(!/^\d+\.bin$/.test(entry.file)||!/^data\/[\w/.-]+\.(bin|json)$/.test(p)||p.includes('..'))throw Error('Unsafe packing cache entry');const path=join(target,entry.file);if(realpathSync(path).toLowerCase()!==path.toLowerCase())throw Error('Packing cache symlink');const b=readFileSync(path);if(hash(b)!==entry.sha256||b.length!==entry.bytes)throw Error('Packing cache hash mismatch');files.set(p,b);}reused=true;
 }else result=make((p,b)=>files.set(p,b));
 validate(result,files); // Same exact decoded input comparison on cache hits and misses.
 for(const[p,b]of files)emit(p,b);
 if(target&&!reused){mkdirSync(target,{recursive:true});const records={};let i=0;for(const[p,b]of files){const name=(i++)+'.bin';writeFileSync(join(target,name),b);records[p]={file:name,sha256:hash(b),bytes:b.length};}const temp=join(target,'receipt.tmp');writeFileSync(temp,JSON.stringify({schema:1,result,files:records}));renameSync(temp,join(target,'receipt.json'));}
 return {...result,reused};
}
export function identityDependencies(identity,months,kind){const area=new Map(),complex=new Set(),lookup=new Map(identity.areas.map((a,i)=>[a[0]+'|'+a[1],i]));for(const v of Object.values(months))for(const k of kind==='quarter'?['daily','rental']:[kind])for(const rows of kind==='quarter'?[v[k].rows,v[k].updates]:[v])for(const r of rows){const n=Number(String(r[0]).slice(6));if(k==='daily'){const a=identity.areas[n];if(!a)throw Error('Unknown cache area');area.set(n,a);complex.add(a[0]);}else{complex.add(n);const i=lookup.get(n+'|'+r[1]);if(i!==undefined)area.set(i,identity.areas[i]);}}
 return {complexes:[...complex].sort((a,b)=>a-b).map(i=>[i,identity.complexes[i]]),areas:[...area].sort(([a],[b])=>a-b)};
}
