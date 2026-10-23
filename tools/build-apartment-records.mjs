import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {encodeRecords,openRecords} from '../js/packed-records.mjs';
import {APARTMENT_FORMAT,compactApartmentRecord,restoreApartmentRecord} from '../js/apartment-records.mjs';
import {privateCache} from './private-cache.mjs';
import * as cacheStore from './cache-store.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const engine=()=>hash(['./build-apartment-records.mjs','./private-cache.mjs','./cache-store.mjs','./cache-blob-store.mjs','../js/apartment-records.mjs','../js/packed-records.mjs','../js/generated/transport-columns.mjs','../schemas/transport.poly'].map(path=>hash(readFileSync(new URL(path,import.meta.url)))).join('|'));
export function apartmentShard(index,key,summary=false){return 'data/apartments/'+(summary?'summary/':'')+key+(index.format===APARTMENT_FORMAT?'.bin':'.json');}
export function apartmentShardValues(bytes,path,metadata){
 if(path.endsWith('.json'))return JSON.parse(bytes);
 const records=openRecords(gunzipSync(bytes));return Object.fromEntries(records.keys().map(id=>[id,restoreApartmentRecord(records.get(id),metadata)]));
}
// Match the old producer's omitted undefined fields before encoding typed nodes.
const normalized=(values,metadata)=>Object.entries(values).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([id,value])=>[id,compactApartmentRecord(JSON.parse(JSON.stringify(value)),metadata)]);
export const encodeApartmentShard=(values,metadata)=>gzipSync(encodeRecords(normalized(values,metadata)),{level:6});
export function packApartmentShards(index,read,{cache=null,directory=null,stats={}}={}){
 const outputs=new Map(),next={...index,format:APARTMENT_FORMAT,shards:{}};
 const code=engine();Object.assign(stats,{encoded:0,reused:0});
 for(let n=0;n<256;n++)for(const summary of [false,true]){
  const key=n.toString(16).padStart(2,'0'),source=apartmentShard(index,key,summary),bytes=read(source);
  if(hash(bytes)!==index.shards[source])throw Error('Apartment source changed: '+source);
  const values=apartmentShardValues(bytes,source,index),path=apartmentShard(next,key,summary);
  const records=normalized(values,next),logicalHash=hash(JSON.stringify(records)),target=directory&&join(directory,path),receipt=target+'.json';let packed;
  if(cache)try{const saved=JSON.parse(cache.read(receipt));if(saved.engine===code&&saved.logicalHash===logicalHash){const bytes=cache.read(target);if(hash(bytes)===saved.sha256){packed=bytes;stats.reused++;}}}catch{}
  if(!packed){packed=gzipSync(encodeRecords(records),{level:6});stats.encoded++;if(cache){cache.write(target,packed);cache.write(receipt,JSON.stringify({engine:code,logicalHash,sha256:hash(packed)}));}}
  outputs.set(path,packed);next.shards[path]=hash(packed);
 }
 outputs.set('data/apartments/index.json',Buffer.from(JSON.stringify(next)));return {index:next,outputs};
}
// Only the explicitly selected output is written. Source JSONs are packing inputs.
export function buildApartmentRecords(source,output,{fallback=null,cacheDir=null}={}){
 source=resolve(source);output=resolve(output);const read=p=>readFileSync(join(existsSync(join(source,p))?source:fallback??source,p));
 const scope='cloudflare/dist/apartment-records-v1',directory=cacheDir?join(resolve(cacheDir),'apartment-records-v1'):join(output,scope),stats={};
 // Native cache paths are keys in the shared artifact store, not DB directories.
 const cache=cacheDir?{read:cacheStore.readFileSync,exists:cacheStore.existsSync,write(path,bytes){cacheStore.mkdirSync(dirname(path),{recursive:true});cacheStore.writeFileSync(path,bytes);}}:privateCache(output,scope);
 try{
  const catalog=JSON.parse(read('data/apartments/index.json')),{index,outputs}=packApartmentShards(catalog,read,{cache,directory,stats});let written=0;
  const emit=(path,bytes)=>{const target=join(output,path);if(existsSync(target)&&readFileSync(target).equals(bytes))return;mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);written++;};
  for(const[path,bytes]of outputs)emit(path,bytes);
  const rental='data/apartment-rent/index.json';if(existsSync(join(source,rental))||fallback&&existsSync(join(fallback,rental))){const value=JSON.parse(read(rental));value.catalogHash=hash(outputs.get('data/apartments/index.json'));emit(rental,Buffer.from(JSON.stringify(value)));}
  return {count:index.count,files:outputs.size,bytes:[...outputs.values()].reduce((n,b)=>n+b.length,0),format:index.format,written,...stats};
 }finally{cache.close?.();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[source,output]=process.argv.slice(2);if(!source||!output||realpathSync(source)===resolve(output))throw Error('Usage: build-apartment-records.mjs SOURCE ISOLATED_OUTPUT');console.log(JSON.stringify(buildApartmentRecords(source,output)));
}
