/* Verified immutable baseline + one cumulative overlay per LAWD/month. */
(function(root){
 'use strict';
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
 const lawd=s=>/^\d{5}$/.test(s),key=(code,id)=>{if(!lawd(code)||!Number.isSafeInteger(id)||id<0)throw Error('잘못된 지역 번호입니다.');return code+':'+id;};
 function exactArea(s){s=String(s);if(!/^\d+(\.\d+)?$/.test(s))throw Error('정확한 면적이 필요합니다.');let [i,f='']=s.split('.');i=i.replace(/^0+/,'')||'0';f=f.replace(/0+$/,'');if(i==='0'&&!f)throw Error('면적은 양수여야 합니다.');return i+(f?'.'+f:'');}
 const canonical=row=>JSON.stringify(row);
 const orderedComplexes=(table,compare=(a,b)=>(a.n||'').localeCompare(b.n||'','ko')||a.key.localeCompare(b.key))=>table.complexes.slice().sort(compare);
 function apply(base,change){
  if(!Array.isArray(base)||!Array.isArray(change?.remove)||!Array.isArray(change?.add))throw Error('변경분 형식을 확인해 주세요.');
  const remove=new Map();for(const p of change.remove){if(!Array.isArray(p)||p.length!==2||!Number.isSafeInteger(p[1])||p[1]<1||remove.has(canonical(p[0])))throw Error('잘못된 제거 건수입니다.');remove.set(canonical(p[0]),p[1]);}
  const result=[];for(const row of base){const k=canonical(row),n=remove.get(k)||0;if(n)remove.set(k,n-1);else result.push(row);}
  if([...remove.values()].some(n=>n))throw Error('기준 자료에 없는 거래를 제거할 수 없습니다.');return result.concat(change.add);
 }
 function tables(descriptor,payloads,kind){
  if(descriptor.schema!==2||!/^[a-f0-9]{40}$/.test(descriptor.baselineCommit)||!descriptor.regions)throw Error('지역 번호표를 확인해 주세요.');
  const complexes=[],areas=[],source=new Map(),regions=new Map();

  for(const [code,entry]of Object.entries(descriptor.regions)){
   if(!lawd(code))throw Error('시군구 코드가 잘못되었습니다.');
   const identity=payloads[entry.identities],metadata=payloads[entry.metadata];
   if(!Array.isArray(identity?.complexes)||!Array.isArray(identity?.areas)||!Array.isArray(metadata?.complexes)||metadata.complexes.length!==identity.complexes.length)throw Error('지역 번호표 자료가 일치하지 않습니다.');
   const seenAreas=new Set();
   identity.complexes.forEach((id,i)=>{if(typeof id!=='string'||!id||source.has(id)||metadata.complexes[i].id!==id)throw Error('원천 단지 번호가 일치하지 않습니다.');const k=key(code,i),c={...metadata.complexes[i],key:k,lawd:code};source.set(id,k);complexes.push(c);complexes[k]=c;});
   identity.areas.forEach(([i,a],n)=>{if(!Number.isSafeInteger(i)||!identity.complexes[i]||exactArea(a)!==a||seenAreas.has(i+':'+a))throw Error('평형 번호가 일치하지 않습니다.');seenAreas.add(i+':'+a);const k=key(code,n),v=[key(code,i),a];areas.push(v);areas[k]=v;});
   regions.set(code,{identity,metadata,entry});
  }
  for(const c of complexes){
   if(c.status!=null&&!['active','retired'].includes(c.status))throw Error('Invalid identity lifecycle status');
   if(c.status==='retired'&&!/^\d{4}-\d{2}-\d{2}$/.test(c.retiredAt||''))throw Error('Retirement date required');
   const seen=new Set();let current=c;
   while(current.representativeKey&&current.representativeKey!==current.key){
    if(seen.has(current.key))throw Error('Representative link cycle');seen.add(current.key);
    const next=complexes[current.representativeKey];
    if(!next||!current.publicId||next.publicId!==current.publicId)throw Error('Representative outside approved publication group');current=next;
   }
  }
  return {complexes,areas,source,regions};
 }
 function merge(shard,overlays,kind,baselineCommit){
  const result={...shard},dateIndex=kind==='daily'?1:2;
  for(const overlay of overlays){
   if(overlay.schema!==1||overlay.baselineCommit!==baselineCommit||!lawd(overlay.lawd)||!/^\d{4}-\d{2}$/.test(overlay.month)||overlay.previous||overlay.parent)throw Error('누적 변경분의 기준이 일치하지 않습니다.');
   const changes=overlay[kind];if(!changes)continue;
   for(const field of ['rows','opening','updates'])if(changes[field]){
    for(const row of [...changes[field].add,...changes[field].remove.map(p=>p[0])])if(!Array.isArray(row)||!String(row[0]).startsWith(overlay.lawd+':'))throw Error('다른 지역의 변경분입니다.');
    result[field]=apply(result[field]||[],changes[field]);
   }
  }
  // Stable sort retains baseline tie ordering. Only actual changed vectors are added.
  for(const field of ['rows','updates'])if(result[field])result[field].sort((a,b)=>a[dateIndex]-b[dateIndex]);return result;
 }
 function overlayPaths(manifest,table,month,province=null){
  return [...table.regions].filter(([,r])=>province==null||r.metadata.complexes.some(c=>c.r===province)).map(([code])=>manifest.regional.overlays?.[code]?.[month]).filter(Boolean);
 }
 function baseMonth(value,code,month,baseline){if(value.schema!==1||value.lawd!==code||value.baselineCommit!==baseline||value.previous||value.parent)throw Error('지역 기준 자료가 일치하지 않습니다.');if(value.months){if(value.quarter!==month.slice(0,4)+'-Q'+Math.ceil(Number(month.slice(5))/3))throw Error('지역 기준 분기가 일치하지 않습니다.');value=value.months[month];}if(!value||value.month!==month||value.lawd!==code||value.baselineCommit!==baseline)throw Error('지역 기준 월이 일치하지 않습니다.');return value;}
 async function create(manifest,kind,load){
  if(manifest.schema!==2||manifest.regional?.format!=='fixed-region')throw Error('새 지역 번호 자료가 필요합니다. 새로고침해 주세요.');
  if(!manifest.regional||manifest.regional.kind!==kind||manifest.regional.previous||manifest.regional.parent)throw Error('지역 자료 형식이 잘못되었습니다.');
  const descriptor=await load(manifest.regional.authority);
  if(descriptor.baselineCommit!==manifest.regional.baselineCommit)throw Error('기준 공개 버전이 일치하지 않습니다.');
  const metadataPaths=[...new Set(Object.values(descriptor.regions).flatMap(r=>[r.identities,r.metadata]))],payloads={};
  await Promise.all(metadataPaths.map(async p=>{payloads[p]=await load(p);}));const table=tables(descriptor,payloads,kind);
  function checkRows(rows,code,field){for(const row of rows){const id=String(row?.[0]),parts=id.split(':'),local=Number(parts[1]);if(parts.length!==2||parts[0]!==code||!Number.isSafeInteger(local)||local<0||String(local)!==parts[1]||!(kind==='daily'?own(table.areas,id):own(table.complexes,id)))throw Error('등록되지 않은 지역 번호입니다.');if(kind==='rental')exactArea(row[1]);}}
  const logical=new Map();
  const paths=(month,province)=>[...table.regions].filter(([,r])=>province==null||r.metadata.complexes.some(c=>c.r===province)).flatMap(([code])=>[manifest.regional.bases?.[code]?.[month],manifest.regional.overlays?.[code]?.[month]].filter(Boolean));
  return {...table,paths,async shard(path,month,province,background=false){
   const cacheKey=month+'|'+province;if(logical.has(cacheKey)){const saved=logical.get(cacheKey);logical.delete(cacheKey);logical.set(cacheKey,saved);if(!background)for(const p of paths(month,province))load.promote?.(p);return saved;}
   const promise=(async()=>{let shard={rows:[],opening:[],updates:[]};
    for(const [code,region]of table.regions){if(province!=null&&!region.metadata.complexes.some(c=>c.r===province))continue;const base=manifest.regional.bases?.[code]?.[month];if(base){const value=baseMonth(await load(base,background),code,month,descriptor.baselineCommit);for(const f of ['rows','opening','updates']){const rows=value[kind]?.[f]||[];checkRows(rows,code,f);for(const row of rows)shard[f].push(row);}}}
    const paths=overlayPaths(manifest,table,month,province),overlays=await Promise.all(paths.map(p=>load(p,background)));for(const v of overlays)for(const f of ['rows','opening','updates'])if(v[kind]?.[f]){checkRows(v[kind][f].add,v.lawd,f);checkRows(v[kind][f].remove.map(p=>p[0]),v.lawd,f);}return merge(shard,overlays,kind,descriptor.baselineCommit);
   })();logical.set(cacheKey,promise);while(logical.size>9)logical.delete(logical.keys().next().value);try{return await promise;}catch(e){logical.delete(cacheKey);throw e;}
  },merge:(shard,overlays)=>merge(shard,overlays,kind,descriptor.baselineCommit)};
 }
 root.NodoRegional={baseMonth,key,exactArea,orderedComplexes,apply,tables,merge,overlayPaths,create};
})(globalThis);
