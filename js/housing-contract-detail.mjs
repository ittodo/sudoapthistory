import {exactDecimal} from './housing-facts.mjs';
const keys=['aptSeq','area','buildYear','cancelDate','cancelled','category','contractTerm','contractType','date','deposit','dong','entityId','floor','identityStatus','jibun','kind','monthlyRent','name','previousDeposit','previousMonthlyRent','price','property','renewalRight'];
export const displayKeys=['aptSeq','buildYear','dong','identityStatus','jibun','name'];
const stableContract=x=>Object.fromEntries(Object.keys(x).filter(k=>!displayKeys.includes(k)).sort().map(k=>[k,x[k]]));
const canonical=x=>JSON.stringify(Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])));
export const rentalCore=(r,source)=>JSON.stringify([source,r[1],r[2],r[3],r[4],r[5],r[6],Boolean(r[7])]);
export function contractCore(r){return JSON.stringify([r.entityId,String(r.area),Number(r.date.replaceAll('-','')),r.deposit,r.monthlyRent,r.contractType==='신규'?1:r.contractType==='갱신'?2:0,r.floor,Boolean(r.cancelled)]);}
export function detailRow(raw,id,occurrence){
 if(Object.keys(raw).sort().join('|')!==keys.join('|')||raw.property!=='apartment'||raw.kind!=='rent'||raw.price!==null||raw.category!==(raw.monthlyRent>0?'monthly':raw.monthlyRent===0?'jeonse':'unknown'))throw Error('Unrecognized apartment contract fields');
 const d=raw.previousDeposit===null?null:exactDecimal(raw.previousDeposit),r=raw.previousMonthlyRent===null?null:exactDecimal(raw.previousMonthlyRent),scale=Math.max(d?.scale||0,r?.scale||0);
 return [id,occurrence,raw.contractTerm,raw.contractType,raw.cancelDate,d?d.mantissa*10n**BigInt(scale-d.scale):null,r?r.mantissa*10n**BigInt(scale-r.scale):null,scale,raw.renewalRight];
}
function amount(v,s){if(v===null)return null;const n=Number(v)/10**s,d=exactDecimal(n),scale=Math.max(s,d.scale);if(v*10n**BigInt(scale-s)!==d.mantissa*10n**BigInt(scale-d.scale))throw Error('Detail amount precision loss');return n;}
export function restoreContract(fact,source,detail,display){
 const date=String(fact[2]);return {...display,area:Number(fact[1]),cancelDate:detail[4],cancelled:Boolean(fact[7]),category:fact[4]>0?'monthly':'jeonse',contractTerm:detail[2],contractType:detail[3],date:date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6),deposit:fact[3],entityId:source,floor:fact[6],kind:'rent',monthlyRent:fact[4],previousDeposit:amount(detail[5],detail[7]),previousMonthlyRent:amount(detail[6],detail[7]),price:null,property:'apartment',renewalRight:detail[8]};
}
export function packContractDetails(rawRows,facts,table,codec){
 const pools=new Map(),ids=new Map();for(const f of facts){const source=table.complexes[f[0]]?.id;if(!source)throw Error('Unknown contract source');const k=rentalCore(f,source),a=pools.get(k)||[];a.push(f);pools.set(k,a);}
 for(const a of pools.values())a.sort((a,b)=>a[17].localeCompare(b[17]));
 const rows=[],unmatched=[],display={},used=new Map();
 // API response order is deliberately not serialized.
 for(const raw of rawRows.slice().sort((a,b)=>canonical(stableContract(a)).localeCompare(canonical(stableContract(b)),'en')||canonical(a).localeCompare(canonical(b),'en'))){
  const candidates=pools.get(contractCore(raw));if(!candidates?.length){unmatched.push([canonical(raw),'not_in_eligible_regional_facts']);continue;}
  const f=candidates.shift(),id=f[17],n=used.get(id)||0;used.set(id,n+1);const row=detailRow(raw,id,n),meta=Object.fromEntries(displayKeys.map(k=>[k,raw[k]]));
  const restored=restoreContract(f,raw.entityId,row,meta);if(canonical(restored)!==canonical(raw))throw Error('Contract detail roundtrip mismatch');
  rows.push(row);display[id+':'+n]=meta;
 }
 rows.sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]);
 return {details:codec.encodeColumns(codec.schemas.ContractDetail,rows),unmatched:codec.encodeColumns(codec.schemas.ContractUnmatched,unmatched),display,matched:rows.length,unmatchedCount:unmatched.length};
}
export function restoreDetails(details,unmatched,display,facts,table,codec,reference=false){
 const pool=new Map();for(const f of facts){if(!pool.has(f[17]))pool.set(f[17],[]);pool.get(f[17]).push(f);}
 const view=codec.openColumns(codec.schemas.ContractDetail,details),extra=codec.openColumns(codec.schemas.ContractUnmatched,unmatched),result=[],used=new Set();
 for(let i=0;i<view.rowCount;i++){const d=view.row(i),key=d[0]+':'+d[1],f=pool.get(d[0])?.[d[1]],meta=display[key];if(!f||!meta||used.has(key))throw Error('Invalid contract detail reference');used.add(key);const value=restoreContract(f,table.complexes[f[0]].id,d,meta);result.push(reference?{...value,recordIdentity:d[0],recordOccurrence:d[1]}:value);}
 if(used.size!==Object.keys(display).length)throw Error('Orphan contract display metadata');
 for(let i=0;i<extra.rowCount;i++){const [json,reason]=extra.row(i);if(reason!=='not_in_eligible_regional_facts')throw Error('Invalid unmatched contract reason');result.push(JSON.parse(json));}return result;
}

export function contractDisplay(details,meta,codec,used=null){const result={},rows=codec.openColumns(codec.schemas.ContractDetail,details);for(let i=0;i<rows.rowCount;i++){const row=rows.row(i),key=row[0]+':'+row[1],n=meta.refs[key];if(!Number.isSafeInteger(n)||!meta.dictionary[n])throw Error('Missing contract display metadata');if(used?.has(key))throw Error('Repeated contract display reference');used?.add(key);result[key]=meta.dictionary[n];}return result;}
