import test from'node:test';import assert from'node:assert/strict';import{packQuarter,encodeQuarter,decodeQuarter}from'../js/housing-quarter.mjs';import{decodeMapQuarter}from'./housing-map-quarter.mjs';import*as codec from'../js/generated/housing-columns.mjs';
const identity={complexes:['A','B'],areas:[[0,'59.001'],[1,'72.12345']]},scope={lawd:'11110',quarter:'2026-Q3'};
function fixture(){
 const months={};for(const m of ['2026-07','2026-08','2026-09']){const d=Number(m.replace('-','')+'01'),sale=['11110:0',d,60000.25,null,2,null,null,null,null,0,'01'.repeat(11),null],rent=['11110:1','72.12345',d,10000.25,100.125,2,null,0,20260601,20000.5,21000.25,30000.75,31000.5,102.375,8,'2026-06',3.5,'02'.repeat(10)];months[m]={daily:{rows:[sale,sale],updates:[['11110:0',d,60000.25,60000.25,60000.25,2]]},rental:{rows:[rent,rent],updates:[rent,rent]}};}
 return packQuarter(scope.lawd,scope.quarter,months,identity,codec);
}
test('map-only quarter preserves exact updates, duplicates, comparison fields and null floor across months',()=>{
 const bytes=encodeQuarter(fixture()),full=decodeQuarter(bytes,identity,codec,scope);
 for(const kind of ['daily','rental']){const focused=decodeMapQuarter(bytes,identity,codec,scope,kind);for(const m of ['2026-07','2026-08','2026-09'])assert.deepEqual(focused.month(m)[kind],{rows:[],updates:full.month(m)[kind].updates});}
});
test('map quarter keeps structural, group/order and scope guards',()=>{
 const value=fixture(),bytes=encodeQuarter(value);
 assert.throws(()=>decodeMapQuarter(bytes.subarray(0,bytes.length-1),identity,codec,scope,'daily'));
 assert.throws(()=>decodeMapQuarter(bytes,identity,codec,{...scope,lawd:'28185'},'daily'));
 const groups=codec.openColumns(codec.schemas.TradeGroup,value.sections.groups),rows=Array.from({length:groups.rowCount},(_,i)=>groups.row(i));rows[1][2]=0;
 const bad={...value,sections:{...value.sections,groups:codec.encodeColumns(codec.schemas.TradeGroup,rows)}};assert.throws(()=>decodeMapQuarter(encodeQuarter(bad),identity,codec,scope,'daily'),/group/i);
 const order=codec.openColumns(codec.schemas.TradeOrder,value.sections.order),entries=Array.from({length:order.rowCount},(_,i)=>order.row(i));entries[1]=entries[0];
 assert.throws(()=>decodeMapQuarter(encodeQuarter({...value,sections:{...value.sections,order:codec.encodeColumns(codec.schemas.TradeOrder,entries)}}),identity,codec,scope,'rental'),/reference/);
});
