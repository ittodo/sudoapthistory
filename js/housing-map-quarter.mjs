// Shared map projection: retain row references, then materialize only the requested month.
// Full transaction readers keep their separate comparison and detail rows.
import{quarterSections}from'./housing-quarter.mjs';import{restoreDecimal}from'./housing-facts.mjs';
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
 const references=new Map(months.map(m=>[m,[]])),result=new Map(),orderUsed=facts.map(f=>new Uint8Array(f.rowCount));
 const target=(m,k)=>{const name=quarter.slice(0,4)+'-'+String(m).padStart(2,'0');if(!references.has(name)||k!==0&&k!==1)throw Error('Invalid month/kind reference');return references.get(name);};
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
  const[m,k,id]=updates.row(i),refs=target(m,k);
  if(k===0){
   if(id>=saleUpdates.rowCount||usedSale[id]++)throw Error('Invalid sale state reference');
   if(!identity.areas[saleUpdates.columns[0].get(id)])throw Error('Unregistered sale state');
   if(String(saleUpdates.columns[1].get(id)).slice(0,6)!==quarter.slice(0,4)+String(m).padStart(2,'0'))throw Error('Invalid state date');
  }else if(id>=facts[1].rowCount||meta[1].months[id]!==m)throw Error('Invalid rental state reference');
  if((k===0?'daily':'rental')===kind)refs.push(id);
 }
 if(usedSale.some(n=>n!==1))throw Error('Unreferenced sale state');
 return{month(month){
  const refs=references.get(month);if(!refs)throw Error('Quarter month not covered');
  if(!result.has(month))result.set(month,{[kind]:{rows:[],updates:refs.map(id=>{
   if(kind==='rental')return rentalRow(id);
   const row=saleUpdates.row(id);row[0]=lawd+':'+row[0];return row;
  })}});
  return result.get(month);
 }};
}
