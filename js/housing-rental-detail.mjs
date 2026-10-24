import {sourceScope,sharedManifest,sharedBytes} from './housing-scope.mjs';
import {contractArchive,rentalDetail} from './contract-archive.mjs';
const archives=new Map();
async function extra(manifest,code){const a=manifest.contractArchive,path=a?.regions[code];if(!path)return null;if(path!==`data/contracts/apartment-rent/${code}/archive-details.bin`)throw Error('Invalid contract archive');const key=path+'|'+a.sources[path];if(!archives.has(key)){const p=sharedBytes(path,a.sources[path]).then(contractArchive);archives.set(key,p);while(archives.size>2)archives.delete(archives.keys().next().value);p.catch(()=>archives.delete(key));}return archives.get(key);}
export async function commonRentalRows(ids,year){
 const groups=new Map();for(const source of new Set(ids)){const scope=await sourceScope('rental',source);if(!scope.route)continue;const code=scope.route.region;if(!groups.has(code))groups.set(code,{scope,ids:new Set()});groups.get(code).ids.add(source);}
 const rows=[];
 for(const[code,{scope,ids:wanted}]of groups){const owner=await sharedManifest('data/apartment-rent/index.json',scope.entry.basis.rental),extras=await extra(owner,code),months=scope.manifest.months.filter(m=>m.startsWith(String(year)));
  const values=await Promise.all(months.map(m=>scope.regional.regionMonth(code,m,false,false)));
  for(const value of values){const occurrences=new Map();for(const f of value.rows){const n=occurrences.get(f[17])||0;occurrences.set(f[17],n+1);const source=scope.regional.complexes[f[0]].id;if(wanted.has(source))rows.push(rentalDetail(f,source,n,extras,scope.regional.complexes[f[0]].property_type??'apartment'));}}
 }
 return rows.sort((a,b)=>b.date.localeCompare(a.date)||a.entityId.localeCompare(b.entityId)||a.recordIdentity.localeCompare(b.recordIdentity)||a.recordOccurrence-b.recordOccurrence);
}
