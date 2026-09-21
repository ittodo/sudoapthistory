import {readFileSync,writeFileSync,existsSync,mkdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';

const hash=b=>createHash('sha256').update(b).digest('hex');
const prefix='data/rental/map-cache/';
// Keep the existing source/area/contract state machine; omit transaction-detail fields.
export function compactMapShard(shard,type){
 const ids=[...new Set([...shard.opening,...shard.updates].map(r=>r[17]))].sort();
 const order=new Map(ids.map((id,i)=>[id,i]));
 const rows=list=>list.filter(r=>(r[4]>0)===(type==='monthly')).map(r=>[r[0],r[1],r[2],r[3],r[4],r[5],r[13],r[14],r[15],r[16],order.get(r[17])]);
 return {schema:2,opening:rows(shard.opening),updates:rows(shard.updates)};
}
export function rentalMapAssets(root){
 const manifestPath=join(root,'data/rental/index.json');if(!existsSync(manifestPath))return [];
 const manifest=JSON.parse(readFileSync(manifestPath)),assets=[],sources={},inputs={};
 // Derived files are packaging outputs, like the existing search catalog. No DB writes.
 const directory=join(root,'cloudflare/dist/rental-map-cache-v1');
 for(const path of [join(root,'cloudflare'),join(root,'cloudflare/dist'),directory])if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('Symlink rental cache output');
 mkdirSync(directory,{recursive:true});
 for(const month of manifest.months){
  if(!/^\d{4}-\d{2}$/.test(month))throw Error('Invalid rental cache month');
  for(const region of ['11','41','28']){
   const input=`data/rental/months/${month}-${region}-state.bin`,expected=manifest.sources[input];
   const raw=readFileSync(join(root,input));if(hash(raw)!==expected)throw Error('Rental cache input changed: '+input);inputs[input]=expected;
   const stamp=join(directory,`${month}-${region}.json`);let saved;
   try{saved=JSON.parse(readFileSync(stamp));}catch{}
   let shard;
   const proof={inputHash:expected,files:{}};
   for(const type of ['jeonse','monthly']){
    const name=`${month}-${region}-${type}.bin`,path=prefix+name,target=join(directory,name);
    let bytes;
    if(saved?.inputHash===expected&&existsSync(target)){const cached=readFileSync(target);if(hash(cached)===saved.files?.[name])bytes=cached;}
    if(!bytes){shard??=JSON.parse(gunzipSync(raw));bytes=gzipSync(JSON.stringify(compactMapShard(shard,type)),{level:6});writeFileSync(target,bytes);}
    if(bytes.length>25*1024*1024)throw Error('Rental cache exceeds asset size limit');
    const digest=hash(bytes);proof.files[name]=digest;sources[path]=digest;assets.push({path,source:target,sha256:digest,size:bytes.length});
   }
   writeFileSync(stamp,JSON.stringify(proof));
  }
 }
 const bytes=Buffer.from(JSON.stringify({schema:1,sourceVersion:manifest.version,inputs,sources}));
 assets.push({path:prefix+'index.json',bytes});return assets;
}
