import './verified-data-cache.js';
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const invalid=()=>Error('잘못된 단지 조회 자료입니다.');
export function restoreApartmentEntry(entry,index){
 if(entry.schema===2){if(!entry.lookup||!entry.routes||!entry.basis)throw invalid();return entry;}
 if(entry.schema!==3||index?.schema!==3||!entry.lookup||!entry.legacy||!entry.routes||!index.metadata||!index.shards||!index.basis)throw invalid();
 const metadata=index.metadata,extension=metadata.format==='packed-records-v1'?'bin':'json';
 const ref=(value,summary=false)=>{const[id,shard]=value;if(typeof id!=='string'||!/^[a-f0-9]{2}$/.test(shard))throw invalid();const path=`data/apartments/${summary?'summary/':''}${shard}.${extension}`,hash=index.shards[path];if(summary&&extension==='json'&&!hash)return null;if(!/^[a-f0-9]{64}$/.test(hash||''))throw invalid();return[id,path,hash];};
 const lookup={},summaries={},legacy={};
 for(const[id,value]of Object.entries(entry.lookup)){lookup[id]=ref(value);const summary=ref(value,true);if(summary)summaries[id]=summary;}
 for(const[row,value]of Object.entries(entry.legacy))legacy[row]=[...ref(value),value[2]];
 return{schema:3,...metadata,basis:{sale:index.basis.sale,rental:index.basis.rental},lookup,summaries,legacy,routes:entry.routes};
}
export function createApartmentEntryReader(load,{verified=false,maxFiles=16}={}){
 let indexPromise;const entries=new Map();
 const index=()=>indexPromise??=(async()=>{let bytes;try{bytes=await load('data/apartments/entry-index.json');}catch(e){if(e.status===404)return null;throw e;}const value=JSON.parse(new TextDecoder().decode(bytes));if(![2,3].includes(value.schema)||!value.sources)throw invalid();return value;})().catch(e=>{indexPromise=null;throw e;});
 return async function read(key){
  const directory=await index(),bucket=(parseInt((await digest(new TextEncoder().encode(key))).slice(0,2),16)&63).toString(16).padStart(2,'0'),path='data/apartments/entry/'+bucket+'.json',hash=directory?.sources[path];
  if(directory&&!/^[a-f0-9]{64}$/.test(hash||''))throw invalid();
  if(entries.has(bucket)){const promise=entries.get(bucket);entries.delete(bucket);entries.set(bucket,promise);return promise;}
  const promise=(async()=>{const bytes=await load(path,hash);if(hash&&!verified&&await digest(bytes)!==hash)throw Error('Apartment entry source changed');return restoreApartmentEntry(JSON.parse(new TextDecoder().decode(bytes)),directory);})();
  entries.set(bucket,promise);while(entries.size>maxFiles)entries.delete(entries.keys().next().value);promise.catch(()=>{if(entries.get(bucket)===promise)entries.delete(bucket);});return promise;
 };
}
let browserReader;
export function apartmentEntry(key){
 if(!browserReader){const cache=globalThis.NodoVerifiedDataCache.create('nodostream-apartment-entries-v3',16,{maxBytes:4*1024*1024});browserReader=createApartmentEntryReader(async(path,hash)=>{if(hash)return cache.download(path,hash);const r=await fetch('/'+path,{cache:'no-cache'});if(!r.ok){const e=Error('단지 조회 자료를 불러오지 못했습니다.');e.status=r.status;throw e;}return r.arrayBuffer();},{verified:true});}
 return browserReader(key);
}
