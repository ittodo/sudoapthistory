import './verified-data-cache.js';
import './regional-data.js';
import {apartmentEntry} from './apartment-entry.mjs';
const manifests=new Map(),scopes=new Map();
const storage=()=>globalThis.NodoVerifiedDataCache.create('nodostream-common-detail-v1',32,{maxBytes:32*1024*1024});
let cache;
export function sharedManifest(path,expected=null){
 const key=path+'|'+(expected||'current');
 if(!manifests.has(key)){const p=(async()=>{cache??=storage();if(expected)return globalThis.NodoVerifiedDataCache.decode(await cache.download(path,expected),path);const r=await fetch('/'+path,{cache:'no-cache'});if(!r.ok)throw Error('거래 자료를 불러오지 못했습니다.');return r.json();})();manifests.set(key,p);p.catch(()=>manifests.delete(key));}
 return manifests.get(key);
}
export async function sharedBytes(path,hash,range=null){cache??=storage();if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('Missing common detail digest');return globalThis.NodoVerifiedDataCache.decode(await cache.download(path,hash,{range}),path);}
export async function sourceScope(kind,source){
 const entry=await apartmentEntry(source);if(!Object.hasOwn(entry.routes,source))throw Error('연결된 단지 자료가 없습니다.');const route=entry.routes[source];
 if(route===null)return {entry,route:null};
 const key=kind+'|'+route.region;
 if(!scopes.has(key)){const p=(async()=>{const manifest=await sharedManifest(kind==='daily'?'data/daily/index.json':'data/rental/index.json');const regional=await globalThis.NodoRegional.create(manifest,kind,p=>sharedBytes(p,manifest.sources[p],manifest.regional?.stateSections?.[p]),{codes:[route.region]});if(regional.source.get(source)!==route.region+':'+route.local)throw Error('단지 지역 연결이 변경되었습니다. 새로고침해 주세요.');return {manifest,regional};})();scopes.set(key,p);while(scopes.size>6)scopes.delete(scopes.keys().next().value);p.catch(()=>scopes.delete(key));}
 const scoped=await scopes.get(key);if(scoped.regional.source.get(source)!==route.region+':'+route.local)throw Error('단지 지역 연결이 일치하지 않습니다.');return {...scoped,entry,route};
}
