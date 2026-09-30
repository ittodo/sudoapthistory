// The existing sale-detail view serializes unknown floors as 0; the shared fact retains null.
// Display grouping is separate from exact-area identity. Match the established ties-to-even grouping.
export const displayArea=n=>n%1===0.5?Math.round(n/2)*2:Math.round(n);
export function saleReferencePool(facts,table){const pool=new Map();for(const f of facts){const[c,a]=table.areas[f[0]],key=JSON.stringify([c,displayArea(Number(a)),f[1],f[2],f[3]??0,f[4]]);if(!pool.has(key))pool.set(key,[]);pool.get(key).push(f);}for(const v of pool.values())v.sort((a,b)=>a[10].localeCompare(b[10]));return pool;}
export function restoreSaleReferences(bytes,facts,table,codec,code){const references=codec.openColumns(codec.schemas.SaleDetailReference,bytes),ids=new Map();for(const f of facts){if(!ids.has(f[10]))ids.set(f[10],[]);ids.get(f[10]).push(f);}const result=new Map(),used=new Set();
 for(let i=0;i<references.rowCount;i++){const[c,a,id,n,position,cancelDate]=references.row(i),f=ids.get(id)?.[n],key=c+'|'+a,ref=id+':'+n;if(!f||used.has(ref)||table.areas[f[0]][0]!==code+':'+c||displayArea(Number(table.areas[f[0]][1]))!==a)throw Error('Invalid sale detail reference');used.add(ref);if(!result.has(key))result.set(key,[]);result.get(key).push({date:f[1],price:f[2],floor:f[3]??0,flags:f[4],cancelled:cancelDate,order:position,identity:id});}
 for(const rows of result.values()){rows.sort((a,b)=>a.order-b.order);if(rows.some((r,i)=>r.order!==i))throw Error('Incomplete sale detail order');}return result;
}

export function excludedSaleRows(bytes,table,codec,code){
 const view=codec.openColumns(codec.schemas.ExcludedSaleFact,bytes),rows=[];
 for(let i=0;i<view.rowCount;i++){const [area,date,price,scale,floor,flags,id,reason]=view.row(i),a=table.areas[code+':'+area];
  if(!a||table.complexes[a[0]]?.hasSale!==false||!(flags&4)||(flags&~5)||reason!=='disappeared_source_without_active_sale'||!/^\d{8}$/.test(String(date)))throw Error('Invalid excluded sale fact');
  const value=Number(price)/10**scale;if(!Number.isSafeInteger(Number(price)))throw Error('Excluded sale amount precision');rows.push([code+':'+area,date,value,floor,flags,null,null,null,null,0,id,null]);
 }return rows;
}
