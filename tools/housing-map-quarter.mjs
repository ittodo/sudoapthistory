// Node map projection: read only day/multiplicity while validating group structure.
// Exact rental facts are materialized only for referenced map updates. Full readers stay unchanged.
import{quarterSections}from'../js/housing-quarter.mjs';import{restoreDecimal}from'../js/housing-facts.mjs';
export function decodeMapQuarter(bytes,identity,codec,scope,kind){
 if(!['daily','rental'].includes(kind))throw Error('Invalid map kind');
 const h=quarterSections(bytes,scope),s=h.sections,{lawd,quarter,months}=h,year=Number(quarter.slice(0,4));
 if(h.schema!==1||!/^\d{5}$/.test(lawd)||!/^\d{4}-Q[1-4]$/.test(quarter)||!Array.isArray(months)||new Set(months).size!==months.length||months.some(m=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)||m.slice(0,4)+'-Q'+Math.ceil(Number(m.slice(5))/3)!==quarter))throw Error('Invalid quarter header');
 const open=(schema,name)=>codec.openColumns(schema,s[name]),facts=[open(codec.schemas.SaleFact,'sale'),open(codec.schemas.RentalFact,'rental')],comparisons=[open(codec.schemas.SaleComparison,'saleComparison'),open(codec.schemas.RentalComparison,'rentalComparison')],groups=open(codec.schemas.TradeGroup,'groups'),order=open(codec.schemas.TradeOrder,'order'),saleUpdates=open(codec.schemas.SaleMapState,'saleUpdates'),updates=open(codec.schemas.StateUpdateOrder,'updates');
 if(comparisons.some((v,k)=>v.rowCount!==facts[k].rowCount))throw Error('Comparison count mismatch');
 const meta=facts.map(f=>({months:new Uint8Array(f.rowCount),areas:new Uint32Array(f.rowCount),source:new Uint32Array(f.rowCount)})),used=facts.map(f=>new Uint8Array(f.rowCount)),positions=[0,0],keys=new Set();
 for(let i=0;i<groups.rowCount;i++){
  const[m,c,a,k,start,count]=groups.row(i);if(k!==0&&k!==1||identity.areas[a]?.[0]!==c||m<1||m>12||count<1||start+count>facts[k].rowCount)throw Error('Invalid map group');
  const key=[m,a,k].join('|');if(keys.has(key))throw Error('Duplicate map group');keys.add(key);const lastDay=new Date(Date.UTC(year,m,0)).getUTCDate();
  for(let j=start;j<start+count;j++){
   if(used[k][j]++)throw Error('Overlapping group');const day=facts[k].columns[0].get(j),multiplicity=facts[k].columns.at(-1).get(j);
   if(multiplicity!==1||day<1||day>lastDay)throw Error('Invalid map fact day/multiplicity');
   const id=positions[k]++;meta[k].months[id]=m;meta[k].areas[id]=a;meta[k].source[id]=j;
  }
 }
 if(used.some(v=>v.some(n=>n!==1)))throw Error('Unreferenced facts');
 const result=Object.fromEntries(months.map(m=>[m,{[kind]:{rows:[],updates:[]}}])),orderUsed=facts.map(f=>new Uint8Array(f.rowCount));
 const target=(m,k)=>{const name=quarter.slice(0,4)+'-'+String(m).padStart(2,'0');if(!result[name]||k!==0&&k!==1)throw Error('Invalid month/kind reference');return result[name];};
 for(let i=0;i<order.rowCount;i++){const[m,k,id]=order.row(i);target(m,k);if(id>=facts[k].rowCount||orderUsed[k][id]++||meta[k].months[id]!==m)throw Error('Invalid fact reference');}
 if(orderUsed.some(v=>v.some(n=>n!==1)))throw Error('Unreferenced fact');
 const usedSale=new Uint8Array(saleUpdates.rowCount),rentalRows=new Array(facts[1].rowCount);
 function rentalRow(id){
  if(rentalRows[id])return rentalRows[id];
  const a=meta[1].areas[id],entry=identity.areas[a],r=facts[1].row(meta[1].source[id]),date=year*10000+meta[1].months[id]*100+r[0];
  const value=[lawd+':'+entry[0],entry[1],date,restoreDecimal(r[2],r[4]),restoreDecimal(r[3],r[4]),r[5],r[1],r[6],...comparisons[1].row(id),r[7]];
  rentalRows[id]=value;return value;
 }
 for(let i=0;i<updates.rowCount;i++){
  const[m,k,id]=updates.row(i),t=target(m,k);let row;
  if(k===0){
   if(id>=saleUpdates.rowCount||usedSale[id]++)throw Error('Invalid sale state reference');
   row=saleUpdates.row(id);if(!identity.areas[row[0]])throw Error('Unregistered sale state');row[0]=lawd+':'+row[0];
   if(String(row[1]).slice(0,6)!==quarter.slice(0,4)+String(m).padStart(2,'0'))throw Error('Invalid state date');
  }else{if(id>=facts[1].rowCount||meta[1].months[id]!==m)throw Error('Invalid rental state reference');if(kind==='rental')row=rentalRow(id);}
  if((k===0?'daily':'rental')===kind)t[kind].updates.push(row);
 }
 if(usedSale.some(n=>n!==1))throw Error('Unreferenced sale state');
 return{month:m=>result[m]||(()=>{throw Error('Quarter month not covered');})()};
}
