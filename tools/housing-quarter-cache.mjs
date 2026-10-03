// Verified private quarter receipts. Public schema and paths remain unchanged.
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,lstatSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';import {gzipSync,gunzipSync} from 'node:zlib';
const hash=b=>createHash('sha256').update(b).digest('hex'),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function quarterMemo(directory,key,code,quarter) {
 if(!/^\d{5}$/.test(code)||!/^\d{4}-Q[1-4]$/.test(quarter))throw Error('Quarter packing scope invalid');
 const digest=hash(JSON.stringify(key)),target=directory?join(resolve(directory),'native-quarters',digest):null;
 const period=m=>/^\d{4}-\d{2}$/.test(m)&&m.slice(0,4)+'-Q'+Math.ceil(Number(m.slice(5))/3)===quarter;
 const allowed=p=>new RegExp('^data/daily/regions/'+code+'/quarters/'+quarter+'(?:(?:-p[01]+|-order)?\\.bin|\\.parts\\.json)$').test(p);
 const safe=p=>{if(lstatSync(p).isSymbolicLink()||realpathSync(p).toLowerCase()!==p.toLowerCase())throw Error('Quarter packing cache link');};
 return {
  load(identity,emit) {
   if(!target||process.env.NODO_FULL_VERIFY==='1'||!existsSync(join(target,'receipt.json')))return null;
   safe(target);safe(join(target,'receipt.json'));const stored=JSON.parse(readFileSync(join(target,'receipt.json'))),b=stored.body;
   if(stored.sha256!==hash(JSON.stringify(b))||b.schema!==1||b.status!=='PASS'||b.key!==digest||b.code!==code||b.quarter!==quarter)throw Error('Quarter packing receipt mismatch');
   if(b.identity.complexes.some((v,i)=>!equal(identity.complexes[i],v)))return null;
   const areas=identity.areas.slice();for(const[i,a]of b.identity.areas.entries()){if(i<areas.length){if(!equal(areas[i],a))return null;}else areas.push(a);}
   const assets=[];for(const[p,r]of Object.entries(b.files)) {
    if(!allowed(p)||!/^\d+\.bin$/.test(r.file))throw Error('Quarter packing cache path');
    const file=join(target,r.file);safe(file);if(lstatSync(file).size>25*1024*1024)throw Error('Quarter packing cache size');
    const bytes=readFileSync(file);if(hash(bytes)!==r.sha256||bytes.length!==r.bytes)throw Error('Quarter packing cache bytes changed');assets.push([p,bytes]);
   }
   for(const[m,p]of Object.entries(b.quarters))if(!period(m)||!b.files[p])throw Error('Quarter packing asset missing');
   const state=join(target,'opening.bin');safe(state);if(lstatSync(state).size>25*1024*1024)throw Error('Quarter opening too large');
   const bytes=readFileSync(state);if(hash(bytes)!==b.openingHash)throw Error('Quarter opening changed');
   const opening=JSON.parse(gunzipSync(bytes,{maxOutputLength:256*1024*1024}));
   for(const kind of ['daily','rental']) {
    if(!opening[kind]||!equal(Object.keys(opening[kind]).sort(),Object.keys(b.quarters).sort()))throw Error('Quarter opening inventory mismatch');
    for(const[m,rows]of Object.entries(opening[kind]))if(!period(m)||!Array.isArray(rows))throw Error('Quarter opening malformed');
   }
   identity.areas=areas;for(const[p,bytes]of assets)emit(p,bytes);
   return {...b,opening};
  },
  save(identity,quarters,opening,metrics,files) {
   if(!target)return;mkdirSync(target,{recursive:true});safe(target);const records={};let n=0;
   for(const[p,bytes]of files){if(!allowed(p))throw Error('Quarter output scope');const file=(n++)+'.bin',dest=join(target,file);if(existsSync(dest))safe(dest);writeFileSync(dest,bytes);records[p]={file,sha256:hash(bytes),bytes:bytes.length};}
   const bytes=gzipSync(Buffer.from(JSON.stringify(opening)),{level:6}),state=join(target,'opening.bin');if(existsSync(state))safe(state);writeFileSync(state,bytes);
   const body={schema:1,status:'PASS',key:digest,code,quarter,identity:structuredClone(identity),quarters,metrics,files:records,openingHash:hash(bytes)};
   const temp=join(target,'receipt.'+process.pid+'.tmp');if(existsSync(temp))safe(temp);
   writeFileSync(temp,JSON.stringify({body,sha256:hash(JSON.stringify(body))}));renameSync(temp,join(target,'receipt.json'));
  }
 };
}
