import{restoreDetails,contractDisplay}from'./housing-contract-detail.mjs';import*as codec from'./generated/housing-columns.mjs';
export function createContractReader(manifest,regional,load){
 if(manifest.schema!==2||!manifest.sources||manifest.rentalVersion!==regional.version)throw Error('Contract/shared transaction version mismatch');
 const pending=new Map();
 async function partition(p){
  if(p.format!=='regional-reference')return load('data/contracts/'+p.path);
  if(!/^\d{5}$/.test(p.lawd)||!/^\d{6}$/.test(p.month))throw Error('Invalid contract scope');const prefix=`data/contracts/apartment-rent/${p.lawd}/${p.month}`;
  if(p.details!==null&&p.details!==prefix+'-details.bin'||p.unmatched!==null&&p.unmatched!==prefix+'-unmatched.bin'||p.display!==null&&p.display!==`data/contracts/apartment-rent/${p.lawd}/display.json`||(p.details===null)!==(p.display===null))throw Error('Contract path mismatch');
  const month=p.month.slice(0,4)+'-'+p.month.slice(4),[details,unmatched,meta,shard]=await Promise.all([p.details?load(p.details):codec.encodeColumns(codec.schemas.ContractDetail,[]),p.unmatched?load(p.unmatched):codec.encodeColumns(codec.schemas.ContractUnmatched,[]),p.display?load(p.display):{refs:{},dictionary:[]},Promise.all(p.regionCodes.map(code=>regional.regionMonth(code,month,false,false))).then(values=>({rows:values.flatMap(v=>v.rows)}))]);
  const display=contractDisplay(details,meta,codec);
  const rows=restoreDetails(details,unmatched,display,shard.rows,regional,codec,true);if(rows.length!==p.count)throw Error('Contract count mismatch');return {rows};
 }
 return {async read(p){const key=p.path;if(!pending.has(key)){pending.set(key,partition(p).catch(e=>{pending.delete(key);throw e;}));while(pending.size>12)pending.delete(pending.keys().next().value);}return pending.get(key);},
 async history(ids,year){const wanted=new Set(ids),codes=new Set([...regional.complexes].filter(c=>[c.id,c.publicId,c.mapId].some(id=>wanted.has(id))).map(c=>c.lawd));const rows=[];for(const p of manifest.partitions)if(p.service==='apartment-rent'&&p.month.startsWith(String(year))&&(p.regionCodes||[p.lawd]).some(code=>codes.has(code)))rows.push(...(await this.read(p)).rows.filter(r=>wanted.has(r.entityId)||[regional.complexes[regional.source.get(r.entityId)]?.publicId,regional.complexes[regional.source.get(r.entityId)]?.mapId].some(id=>wanted.has(id))));return rows;}};
}
export async function browserContractReader(regional=null,rentalManifest=null){
 const shared=globalThis.NodoVerifiedDataCache;if(!shared||!globalThis.NodoRegional)throw Error('Shared data runtime missing');const cache=shared.create('nodostream-contracts-v2',24);
 const readManifest=async p=>{const r=await fetch('/'+p,{cache:'no-cache'});if(!r.ok)throw Error('계약 자료를 불러오지 못했습니다.');return r.json();};
 const manifest=await readManifest('data/contracts/index.json');rentalManifest??=await readManifest('data/rental/index.json');
 const loadFor=m=>async p=>{const expected=m.sources?.[p];if(!/^[a-f0-9]{64}$/.test(expected||''))throw Error('Missing contract source digest');return shared.decode(await cache.download(p,expected),p);};
 regional??=await globalThis.NodoRegional.create(rentalManifest,'rental',loadFor(rentalManifest));
 return createContractReader(manifest,{...regional,version:rentalManifest.version},loadFor(manifest));
}
