// Converts source-preserving regional fact vectors into schema-generated group/column tables.
export function exactDecimal(value){
 if(typeof value!=='number'||!Number.isFinite(value))throw Error('Finite source amount required');
 const match=String(value).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);if(!match)throw Error('Invalid decimal');
 let scale=(match[3]||'').length-Number(match[4]||0),mantissa=BigInt((match[1]||'')+match[2]+(match[3]||''));
 if(scale<0){mantissa*=10n**BigInt(-scale);scale=0;}while(scale>0&&mantissa%10n===0n){mantissa/=10n;scale--;}
 if(scale>255)throw Error('Decimal scale out of range');return {mantissa,scale};
}
function restore(n,scale){const v=Number(n)/10**scale;if(!Number.isFinite(v))throw Error('Amount outside display range');const back=exactDecimal(v),factor=Math.max(scale,back.scale);if(n*10n**BigInt(factor-scale)!==back.mantissa*10n**BigInt(factor-back.scale))throw Error('Amount cannot be represented without loss');return v;}
const compare=(a,b)=>a<b?-1:a>b?1:0;
function exactArea(value){const s=String(value);if(!/^(0|[1-9]\d*)(\.\d*[1-9])?$/.test(s)||s==='0')throw Error('Canonical positive exact area required');return s;}
function local(key,lawd){const [code,id,...extra]=String(key).split(':');if(extra.length||code!==lawd||!/^\d+$/.test(id)||String(Number(id))!==id||!Number.isSafeInteger(Number(id))||Number(id)>0xffffffff)throw Error('Wrong regional key');return Number(id);}
export function factVectors(months){const result={sale:[],rental:[]};for(const m of Object.keys(months).sort()){for(const r of months[m].daily.rows)result.sale.push([...r.slice(0,5),r[10]]);for(const r of months[m].rental.rows)result.rental.push([...r.slice(0,8),r[17]]);}return result;}
export function packFacts(lawd,months,identity,codec){
 if(!/^\d{5}$/.test(lawd))throw Error('Invalid region');
 const monthNames=Object.keys(months).sort(),quarters=new Set(monthNames.map(m=>m.slice(0,4)+'-Q'+Math.ceil(Number(m.slice(5))/3)));if(quarters.size>1)throw Error('One quarter required');
 const seenAreas=new Set();for(const [complex,area]of identity.areas){if(!Number.isSafeInteger(complex)||complex<0||complex>=identity.complexes.length||exactArea(area)!==area||seenAreas.has(complex+'|'+area))throw Error('Invalid identity table');seenAreas.add(complex+'|'+area);}
 const areas=identity.areas.map(a=>a.slice()),lookup=new Map(areas.map(([c,a],i)=>[c+'|'+a,i])),groups=new Map();
 // Allocate only missing exact areas at the end, in deterministic order for this batch.
 const missing=new Map();for(const m of Object.values(months))for(const r of m.rental.rows){const c=local(r[0],lawd),area=exactArea(r[1]),key=c+'|'+area;if(c>=identity.complexes.length||!/^\d+(\.\d+)?$/.test(area))throw Error('Unregistered source/invalid area');if(!lookup.has(key))missing.set(key,[c,area]);}
 for(const [key,value]of [...missing].sort((a,b)=>a[1][0]-b[1][0]||compare(String(a[1][1]),String(b[1][1])))){lookup.set(key,areas.length);areas.push(value);}
 for(const month of Object.keys(months).sort()){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Invalid month');
  for(const kind of ['daily','rental'])for(const r of months[month][kind].rows){const date=kind==='daily'?r[1]:r[2];if(!Number.isSafeInteger(date)||String(date).slice(0,6)!==month.replace('-',''))throw Error('Trade outside month');const day=date%100;if(day<1||day>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate())throw Error('Invalid contract date');
   const area=kind==='daily'?local(r[0],lawd):lookup.get(local(r[0],lawd)+'|'+r[1]);if(area===undefined||!areas[area])throw Error('Unknown exact area');const complex=areas[area][0],key=month+'|'+area+'|'+kind;let g=groups.get(key);if(!g){g={month:Number(month.slice(5)),complex,area,kind,rows:[]};groups.set(key,g);}
   let row;if(kind==='daily'){const p=exactDecimal(r[2]);row=[day,r[3],p.mantissa,p.scale,r[4],r[10],1];}else{const d=exactDecimal(r[3]),rent=exactDecimal(r[4]),scale=Math.max(d.scale,rent.scale);row=[day,r[6],d.mantissa*10n**BigInt(scale-d.scale),rent.mantissa*10n**BigInt(scale-rent.scale),scale,r[5],r[7],r[17],1];}g.rows.push(row);
  }
 }
 const groupRows=[],sale=[],rental=[];for(const g of [...groups.values()].sort((a,b)=>a.month-b.month||a.complex-b.complex||a.area-b.area||compare(a.kind,b.kind))){const destination=g.kind==='daily'?sale:rental;g.rows.sort((a,b)=>a[0]-b[0]||compare(String(a.at(-2)),String(b.at(-2)))||compare(a.map(String).join('|'),b.map(String).join('|')));groupRows.push([g.month,g.complex,g.area,g.kind==='daily'?0:1,destination.length,g.rows.length]);destination.push(...g.rows);}
 return {year:monthNames.length?Number(monthNames[0].slice(0,4)):null,areas,addedAreas:areas.length-identity.areas.length,groups:codec.encodeColumns(codec.schemas.TradeGroup,groupRows),sale:codec.encodeColumns(codec.schemas.SaleFact,sale),rental:codec.encodeColumns(codec.schemas.RentalFact,rental)};
}
export function unpackFacts(lawd,year,packed,codec){const groups=codec.openColumns(codec.schemas.TradeGroup,packed.groups),sale=codec.openColumns(codec.schemas.SaleFact,packed.sale),rental=codec.openColumns(codec.schemas.RentalFact,packed.rental),result={sale:[],rental:[]};
 if(!/^\d{5}$/.test(lawd)||!Number.isInteger(year)||year<1||year>9999||packed.year!=null&&packed.year!==year)throw Error('Invalid region/year');
 const used=[new Uint8Array(sale.rowCount),new Uint8Array(rental.rowCount)],keys=new Set();
 for(let i=0;i<groups.rowCount;i++){const [month,complex,area,kind,start,count]=groups.row(i);if(packed.areas[area]?.[0]!==complex)throw Error('Group identity mismatch');const source=kind===0?sale:rental;const key=[month,area,kind].join('|');if(keys.has(key)||month<1||month>12||count<1)throw Error('Duplicate/invalid group');keys.add(key);if(kind!==0&&kind!==1||start+count>source.rowCount)throw Error('Group range invalid');for(let j=start;j<start+count;j++){if(used[kind][j]++)throw Error('Overlapping group');const r=source.row(j);if(r.at(-1)!==1)throw Error('Unsupported fact multiplicity');if(r[0]<1||r[0]>new Date(Date.UTC(year,month,0)).getUTCDate())throw Error('Invalid day');const date=year*10000+month*100+r[0];if(kind===0)result.sale.push([lawd+':'+area,date,restore(r[2],r[3]),r[1],r[4],r[5]]);else result.rental.push([lawd+':'+complex,packed.areas[area][1],date,restore(r[2],r[4]),restore(r[3],r[4]),r[5],r[1],r[6],r[7]]);}}
 if(used.some(v=>v.some(n=>n!==1)))throw Error('Unreferenced facts');return result;
}
