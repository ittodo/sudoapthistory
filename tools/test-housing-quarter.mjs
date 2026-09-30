import {test} from 'node:test';import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';
import{packQuarter,encodeQuarter,decodeQuarter}from'../js/housing-quarter.mjs';
import{regionalReader}from'./regional-data.mjs';
const codec=await import(process.env.HOUSING_CODEC?pathToFileURL(process.env.HOUSING_CODEC):new URL('../js/generated/housing-columns.mjs',import.meta.url));
test('current complete quarter preserves rows, comparisons and state updates exactly',()=>{
 const d=regionalReader(process.cwd(),'daily'),r=regionalReader(process.cwd(),'rental');
 for(const lawd of ['11110','11680','41135','28185']){
  const months=Object.fromEntries(['2026-07','2026-08','2026-09'].map(m=>[m,{daily:d.regionMonth(lawd,m),rental:r.regionMonth(lawd,m)}])),id=d.table.regions.get(lawd).identity;
  const packed=packQuarter(lawd,'2026-Q3',months,id,codec),bytes=encodeQuarter(packed),reader=decodeQuarter(bytes,{...id,areas:packed.areas},codec,{lawd,quarter:'2026-Q3'});
  for(const month of Object.keys(months))for(const kind of ['daily','rental'])for(const f of ['rows','updates'])assert.deepEqual(reader.month(month)[kind][f],months[month][kind][f]);
  assert.throws(()=>decodeQuarter(bytes.subarray(0,bytes.length-1),id,codec,{lawd,quarter:'2026-Q3'}));
  console.log(lawd+' quarter bytes '+bytes.length);
 }
});
