import {openRecords,FORMAT} from './packed-records.mjs';

export const JSON_FORMAT='gzip-json-records-v1';
async function jsonRecords(bytes,expected){
 let size=0;
 const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TransformStream({transform(chunk,controller){
  size+=chunk.byteLength;if(size>expected)throw Error('Invalid JSON records byte length');controller.enqueue(chunk);
 }}));
 const text=await new Response(stream).text();if(size!==expected)throw Error('Invalid JSON records byte length');
 const records=JSON.parse(text);if(!records||typeof records!=='object'||Array.isArray(records))throw Error('Invalid JSON records object');
 return {keys:()=>Object.keys(records),get:key=>Object.hasOwn(records,key)?records[key]:undefined};
}

export function packedDataset(manifest,{cache=globalThis.NodoVerifiedDataCache?.createHousing(),decode=globalThis.NodoVerifiedDataCache?.decode,maxFiles=4,maxBytes=64*1024*1024}={}){
 const {prefix,buckets,sources}=manifest;
 const json=manifest.format===JSON_FORMAT;
 if((!json&&manifest.format!==FORMAT)||!/^data(?:\/[a-z0-9-]+)+$/.test(prefix)||!Number.isInteger(buckets)||buckets<1||buckets>256||!sources||typeof cache?.download!=='function'||(!json&&typeof decode!=='function')||!Number.isSafeInteger(maxFiles)||maxFiles<0||!Number.isSafeInteger(maxBytes)||maxBytes<0)throw Error('Invalid packed dataset');
 const routes=new Map(),opened=new Map(),pending=new Map();let retained=0;
 for(const [path,sha]of Object.entries(sources)){
  const file=path.slice(prefix.length+1),match=/^([a-f0-9]{2})-([a-f0-9]{64})\.bin$/.exec(file);
  if(!path.startsWith(prefix+'/')||!match||match[2]!==sha||parseInt(match[1],16)>=buckets||routes.has(parseInt(match[1],16)))throw Error('Invalid packed dataset source');
  const rawBytes=manifest.rawBytes?.[path];if(json&&(!Number.isSafeInteger(rawBytes)||rawBytes<2))throw Error('Invalid JSON records byte length');
  routes.set(parseInt(match[1],16),[path,sha,rawBytes]);
 }
 if(routes.size!==buckets)throw Error('Missing packed dataset bucket');
 if(json&&Object.keys(manifest.rawBytes).length!==routes.size)throw Error('Invalid JSON records byte lengths');
 async function bucket(i){
  if(opened.has(i)){const entry=opened.get(i);opened.delete(i);opened.set(i,entry);return entry.reader;}
  if(!pending.has(i))pending.set(i,(async()=>{const [path,sha,rawBytes]=routes.get(i),bytes=await cache.download(path,sha);
   const raw=json?null:await decode(bytes,path),reader=json?await jsonRecords(bytes,rawBytes):openRecords(raw),size=json?rawBytes:raw.byteLength;
   // JSON entries use verified UTF-8 source bytes for accounting, not JS heap size.
   if(maxFiles&&size<=maxBytes){
    while(opened.size&&(opened.size>=maxFiles||retained+size>maxBytes)){const oldest=opened.keys().next().value;retained-=opened.get(oldest).bytes;opened.delete(oldest);}
    opened.set(i,{reader,bytes:size});retained+=size;
   }
   return reader;
  })().finally(()=>pending.delete(i)));
  return pending.get(i);
 }
 return {
  async get(key){if(typeof key!=='string')throw Error('Invalid packed record key');const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));return(await bucket(new Uint8Array(bytes)[0]%buckets)).get(key);},
  async all(){const values=[];let next=0;await Promise.all(Array.from({length:Math.min(4,buckets)},async()=>{while(next<buckets){const reader=await bucket(next++);for(const key of reader.keys())values.push([key,reader.get(key)]);}}));values.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);return values.map(x=>x[1]);}
 };
}
