import{readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,renameSync}from'node:fs';import{join,resolve}from'node:path';import{createHash}from'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function packedMemo(cacheDir,key,make,validate,emit,{reuseValidation=false}={}){
 const keyHash=hash(JSON.stringify(key)),target=cacheDir?join(resolve(cacheDir),keyHash):null;let result,files=new Map(),reused=false,validated=false;
 if(target&&process.env.NODO_FULL_VERIFY!=='1'&&existsSync(join(target,'receipt.json'))){const receipt=JSON.parse(readFileSync(join(target,'receipt.json')));if(![1,2].includes(receipt.schema))throw Error('Packing cache schema');
  if(receipt.schema===2){const {sha256,...body}=receipt;if(hash(JSON.stringify(body))!==sha256||body.key!==keyHash||body.validation!=='PASS')throw Error('Packing validation receipt mismatch');validated=true;}result=receipt.result;
  for(const[p,entry]of Object.entries(receipt.files)){if(!/^\d+\.bin$/.test(entry.file)||!/^data\/[\w/.-]+\.(bin|json)$/.test(p)||p.includes('..'))throw Error('Unsafe packing cache entry');const path=join(target,entry.file);if(realpathSync(path).toLowerCase()!==path.toLowerCase())throw Error('Packing cache symlink');const b=readFileSync(path);if(hash(b)!==entry.sha256||b.length!==entry.bytes)throw Error('Packing cache hash mismatch');files.set(p,b);}reused=true;
 }else result=make((p,b)=>files.set(p,b));
 // Successful semantic checks may be reused only with the exact input/code key
 // and independently verified current output bytes. Old receipts have no proof.
 const validationReused=reuseValidation&&reused&&validated;
 if(!validationReused)validate(result,files);
 for(const[p,b]of files)emit(p,b);
 if(target&&(!reused||!validated)){mkdirSync(target,{recursive:true});const records={};let i=0;for(const[p,b]of files){const name=(i++)+'.bin';writeFileSync(join(target,name),b);records[p]={file:name,sha256:hash(b),bytes:b.length};}const temp=join(target,'receipt.tmp');const body={schema:2,key:keyHash,validation:'PASS',result,files:records};writeFileSync(temp,JSON.stringify({...body,sha256:hash(JSON.stringify(body))}));renameSync(temp,join(target,'receipt.json'));}
 return {...result,reused,validationReused};
}
export function identityDependencies(identity,months,kind){const area=new Map(),complex=new Set(),lookup=new Map(identity.areas.map((a,i)=>[a[0]+'|'+a[1],i]));for(const v of Object.values(months))for(const k of kind==='quarter'?['daily','rental']:[kind])for(const rows of kind==='quarter'?[v[k].rows,v[k].updates]:[v])for(const r of rows){const n=Number(String(r[0]).slice(6));if(k==='daily'){const a=identity.areas[n];if(!a)throw Error('Unknown cache area');area.set(n,a);complex.add(a[0]);}else{complex.add(n);const i=lookup.get(n+'|'+r[1]);if(i!==undefined)area.set(i,identity.areas[i]);}}
 return {complexes:[...complex].sort((a,b)=>a-b).map(i=>[i,identity.complexes[i]]),areas:[...area].sort(([a],[b])=>a-b)};
}
