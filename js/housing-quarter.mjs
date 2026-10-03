import {packFacts,unpackFacts} from './housing-facts.mjs';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fact=(r,kind)=>kind===0?[...r.slice(0,5),r[10]]:[...r.slice(0,8),r[17]];
const fail=message=>{throw Error(message);};
function queues(months,kind){const result=new Map();for(const month of Object.keys(months).sort())for(const row of months[month][kind===0?'daily':'rental'].rows){const key=JSON.stringify(fact(row,kind));if(!result.has(key))result.set(key,[]);result.get(key).push(row);}return result;}
export function packQuarter(lawd,quarter,months,identity,codec){
 if(!/^\d{4}-Q[1-4]$/.test(quarter)||Object.keys(months).some(m=>m.slice(0,4)+'-Q'+Math.ceil(Number(m.slice(5))/3)!==quarter))fail('Quarter scope mismatch');
 const year=Number(quarter.slice(0,4)),packed=packFacts(lawd,months,identity,codec),facts=unpackFacts(lawd,year,packed,codec);
 const sale=[],rental=[],saleComparisons=[],rentalComparisons=[];
 for(const kind of [0,1]){const pool=queues(months,kind),destination=kind===0?sale:rental,comparisons=kind===0?saleComparisons:rentalComparisons;for(const f of kind===0?facts.sale:facts.rental){const row=pool.get(JSON.stringify(f))?.shift();if(!row)fail('Missing source fact');destination.push(row);comparisons.push(kind===0?[row[5],row[6],row[7],row[8],row[9],row[11]]:row.slice(8,17));}}
 const order=[],updates=[],saleUpdates=[];
 const ids=[new Map(),new Map()];for(const kind of [0,1])for(const [id,row]of(kind===0?sale:rental).entries()){const key=JSON.stringify(row);if(!ids[kind].has(key))ids[kind].set(key,[]);ids[kind].get(key).push(id);}
 const cursor=[new Map(),new Map()];
 for(const month of Object.keys(months).sort())for(const kind of [0,1]){
  const m=Number(month.slice(5)),shard=months[month][kind===0?'daily':'rental'];
  for(const row of shard.rows){const key=JSON.stringify(row),offset=cursor[kind].get(key)||0,id=ids[kind].get(key)?.[offset];if(id===undefined)fail('Unmatched quarter order');cursor[kind].set(key,offset+1);order.push([m,kind,id]);}
  for(const row of shard.updates||[]){if(kind===0){if(!String(row[0]).startsWith(lawd+':'))fail('Wrong update region');updates.push([m,0,saleUpdates.length]);saleUpdates.push([Number(row[0].slice(6)),...row.slice(1)]);}else{const id=ids[1].get(JSON.stringify(row))?.[0];if(id===undefined)fail('Rental update without source fact');updates.push([m,1,id]);}}
 }
 const sections={groups:packed.groups,sale:packed.sale,rental:packed.rental,saleComparison:codec.encodeColumns(codec.schemas.SaleComparison,saleComparisons),rentalComparison:codec.encodeColumns(codec.schemas.RentalComparison,rentalComparisons),order:codec.encodeColumns(codec.schemas.TradeOrder,order),saleUpdates:codec.encodeColumns(codec.schemas.SaleMapState,saleUpdates),updates:codec.encodeColumns(codec.schemas.StateUpdateOrder,updates)};
 return {schema:1,lawd,quarter,months:Object.keys(months).sort(),areas:packed.areas,sections};
}
export function openQuarter(value,identity,codec){
 const {lawd,quarter,months,sections:s}=value;
 if(value.schema!==1||!/^\d{5}$/.test(lawd)||!/^\d{4}-Q[1-4]$/.test(quarter)||!Array.isArray(months)||new Set(months).size!==months.length||months.some(m=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)||m.slice(0,4)+'-Q'+Math.ceil(Number(m.slice(5))/3)!==quarter))fail('Invalid quarter header');
 const facts=unpackFacts(lawd,Number(quarter.slice(0,4)),{areas:identity.areas,groups:s.groups,sale:s.sale,rental:s.rental},codec);
 const comparisons=[codec.openColumns(codec.schemas.SaleComparison,s.saleComparison),codec.openColumns(codec.schemas.RentalComparison,s.rentalComparison)];
 if(comparisons[0].rowCount!==facts.sale.length||comparisons[1].rowCount!==facts.rental.length)fail('Comparison count mismatch');
 const rows=[facts.sale.map((f,i)=>{const c=comparisons[0].row(i);return [...f.slice(0,5),...c.slice(0,5),f[5],c[5]];}),facts.rental.map((f,i)=>[...f.slice(0,8),...comparisons[1].row(i),f[8]])];
 const result=Object.fromEntries(months.map(m=>[m,{daily:{rows:[],updates:[]},rental:{rows:[],updates:[]}}]));
 const order=codec.openColumns(codec.schemas.TradeOrder,s.order),used=rows.map(r=>new Uint8Array(r.length));
 function target(month,kind){const m=quarter.slice(0,4)+'-'+String(month).padStart(2,'0');if(!result[m]||kind!==0&&kind!==1)fail('Invalid month/kind reference');return result[m][kind===0?'daily':'rental'];}
 for(let i=0;i<order.rowCount;i++){const [m,k,id]=order.row(i),t=target(m,k),row=rows[k][id];if(!row||used[k][id]++||String(row[k===0?1:2]).slice(0,6)!==quarter.slice(0,4)+String(m).padStart(2,'0'))fail('Invalid fact reference');t.rows.push(row);}
 if(used.some(v=>v.some(n=>n!==1)))fail('Unreferenced fact');
 const saleUpdates=codec.openColumns(codec.schemas.SaleMapState,s.saleUpdates),updates=codec.openColumns(codec.schemas.StateUpdateOrder,s.updates),usedSale=new Uint8Array(saleUpdates.rowCount);
 for(let i=0;i<updates.rowCount;i++){const [m,k,id]=updates.row(i),t=target(m,k);let row;if(k===0){if(id>=saleUpdates.rowCount||usedSale[id]++)fail('Invalid sale state reference');row=saleUpdates.row(id);row[0]=lawd+':'+row[0];}else row=rows[1][id];if(!row||String(row[k===0?1:2]).slice(0,6)!==quarter.slice(0,4)+String(m).padStart(2,'0'))fail('Invalid state date');t.updates.push(row);}
 if(usedSale.some(n=>n!==1))fail('Unreferenced sale state');return {month:m=>result[m]||fail('Quarter month not covered')};
}
export function encodeQuarter(value){
 let offset=0;const directory={};for(const [name,bytes]of Object.entries(value.sections)){directory[name]=[offset,bytes.length];offset+=bytes.length;}
 const header=new TextEncoder().encode(JSON.stringify({schema:1,lawd:value.lawd,quarter:value.quarter,months:value.months,sections:directory}));if(header.length>1048576)fail('Quarter header too large');
 const out=new Uint8Array(12+header.length+offset);out.set(new TextEncoder().encode('PGHOUSE1'));new DataView(out.buffer).setUint32(8,header.length,true);out.set(header,12);for(const[name,bytes]of Object.entries(value.sections))out.set(bytes,12+header.length+directory[name][0]);return out;
}
export function quarterSections(bytes,scope){
 if(!(bytes instanceof Uint8Array)||bytes.length<12||new TextDecoder().decode(bytes.subarray(0,8))!=='PGHOUSE1')fail('Wrong quarter format');const n=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(8,true);if(n>1048576||n>bytes.length-12)fail('Invalid quarter header');const h=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(12,12+n)));if(!scope||h.lawd!==scope.lawd||h.quarter!==scope.quarter)fail('Quarter scope mismatch');const names=['groups','sale','rental','saleComparison','rentalComparison','order','saleUpdates','updates'];if(!h.sections||Object.keys(h.sections).sort().join('|')!==names.sort().join('|'))fail('Quarter section set mismatch');let cursor=0;const sections={};for(const[name,pair]of Object.entries(h.sections||{})){if(!Array.isArray(pair)||pair.length!==2||pair[0]!==cursor||!Number.isSafeInteger(pair[1])||pair[1]<0||12+n+cursor+pair[1]>bytes.length)fail('Invalid section');sections[name]=bytes.subarray(12+n+cursor,12+n+cursor+pair[1]);cursor+=pair[1];}if(12+n+cursor!==bytes.length)fail('Trailing quarter bytes');return {...h,sections};
}

export function decodeQuarter(bytes,identity,codec,scope){return openQuarter(quarterSections(bytes,scope),identity,codec);}
