import {openRecords} from './packed-records.mjs';
import './verified-data-cache.js';
import {apartmentEntry} from './apartment-entry.mjs';

export const APARTMENT_FORMAT='packed-records-v1';
// Flags distinguish inherited stamps from absent fields and per-record overrides.
export function compactApartmentRecord(value,metadata={}){
 const record={...value};let flags=0;
 for(const [field,bit] of [['updated',1],['propertyUpdated',2]])if(Object.hasOwn(record,field)&&Object.hasOwn(metadata,field)&&record[field]===metadata[field]){delete record[field];flags|=bit;}
 return [flags,record];
}
export function restoreApartmentRecord(value,metadata={}){
 if(value===undefined)return undefined;
 if(!Array.isArray(value))return value; // Existing JSON fixtures.
 const [flags,record]=value;if(value.length!==2||!Number.isInteger(flags)||flags<0||flags>3||!record||typeof record!=='object'||Array.isArray(record))throw Error('Invalid apartment record');
 const result={...record};for(const[field,bit]of [['updated',1],['propertyUpdated',2]])if(flags&bit){if(!Object.hasOwn(metadata,field))throw Error('Missing apartment metadata');result[field]=metadata[field];}return result;
}
export function createApartmentRecordReader(load,{verified=false,maxFiles=16,maxBytes=32*1024*1024}={}){
 const files=new Map();let retained=0;
 return async function read(ref,metadata={}){
  const [id,path,hash]=ref||[];if(typeof id!=='string'||!/^data\/apartments\/(?:summary\/)?[a-f0-9]{2}\.(?:bin|json)$/.test(path||'')||!/^[a-f0-9]{64}$/.test(hash||''))throw Error('Invalid apartment reference');
  const key=path+'|'+hash;let item=files.get(key);
  if(item){files.delete(key);files.set(key,item);}else{
   item={bytes:0};item.promise=(async()=>{
    const bytes=await load(path,hash);
    if(!verified){const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(digest!==hash)throw Error('Apartment source changed');}
    const decoded=await globalThis.NodoVerifiedDataCache.decode(bytes,path);
    const view=path.endsWith('.bin')?openRecords(decoded):{get:id=>decoded[id]};
    item.bytes=decoded.byteLength??bytes.byteLength;if(files.get(key)===item)retained+=item.bytes;
    while(files.size>maxFiles||retained>maxBytes){const oldest=files.keys().next().value;if(oldest===undefined)break;retained-=files.get(oldest).bytes;files.delete(oldest);}return view;
   })();files.set(key,item);item.promise.catch(()=>{if(files.get(key)===item){retained-=item.bytes;files.delete(key);}});
  }
  return restoreApartmentRecord((await item.promise).get(id),metadata);
 };
}
let browserReader,catalogPromise;
export function readApartmentRecord(ref,metadata={}){
 if(!browserReader){const cache=globalThis.NodoVerifiedDataCache.create('nodostream-apartment-records-v1',24,{maxBytes:32*1024*1024});browserReader=createApartmentRecordReader((path,hash)=>cache.download(path,hash),{verified:true});}
 return browserReader(ref,metadata);
}
export async function apartmentSummary(id){
 let entry;try{entry=await apartmentEntry(id);}catch(e){if(e.status!==404)throw e;}
 if(entry?.summaries?.[id])return readApartmentRecord(entry.summaries[id],entry);
 if(entry?.schema===3)return null;
 // Compatibility with old entry fixtures and pre-conversion catalogs only.
 catalogPromise??=fetch('/data/apartments/index.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('단지 자료를 불러오지 못했습니다.');return r.json();}).catch(e=>{catalogPromise=null;throw e;});
 const catalog=await catalogPromise,ref=catalog.lookup[id]||catalog.legacy[id];if(!ref)return null;const canonical=catalog.lookup[ref[0]];if(!canonical)return null;
 const path='data/apartments/summary/'+canonical[1]+(catalog.format===APARTMENT_FORMAT?'.bin':'.json');
 return (await readApartmentRecord([canonical[0],path,catalog.shards[path]],catalog))??null;
}
