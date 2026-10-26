import test from 'node:test';
import assert from 'node:assert/strict';
import {directSaleRows} from '../js/housing-sale-detail.mjs';
import {createSaleReader} from '../js/housing-sales.mjs';
import {mergeSaleSummaries,addGroupSaleAreas} from './complete-group-sale-areas.mjs';
import {summarize} from './build-apartment-data.mjs';
import {selectApartmentMember} from '../js/apartment-groups.mjs';

const table={source:new Map([['A','11110:1'],['B','11110:2']]),areas:{'11110:1':['11110:1','60.45'],'11110:2':['11110:1','60.5'],'11110:3':['11110:2','60.45']},complexes:{'11110:1':{property_type:'rowhouse'}}};
const fact=(date,price,flags=0)=>['11110:1',date,price,null,flags,null,null,null,null,32,'same-identity',null];
test('direct facts retain exact areas, unknown floors, multiplicity and invalidation flags',()=>{
 const original=[fact(20200101,100),fact(20200101,100),fact(20200102,200,2),fact(20200103,300,4),['11110:2',20200104,400,3,0,null,null,null,null,32,'other',null],['11110:3',20200105,999,2,0]];
 const rows=directSaleRows(original,table,'A',60);
 assert.equal(rows.length,5);assert.equal(rows[0].floor,null);assert.equal(rows[0].exactArea,'60.45');assert.equal(rows[4].exactArea,'60.5');assert.deepEqual(rows.slice(2,4).map(r=>r.flags),[2,4]);assert.equal(summarize(rows).total,3);
 assert.equal(rows.filter(r=>r.identity==='same-identity').length,4);assert.deepEqual(original[0],fact(20200101,100));
});
test('merged summaries match raw recomputation across years, ties, cancellations and duplicates',()=>{
 const a=[{date:20260909,price:42000,flags:0,row:7,order:0},{date:20260201,price:40000,flags:0,row:7,order:1},{date:20260102,price:25000,flags:2,row:7,order:2},{date:20251231,price:12000,flags:0,row:7,order:3}];
 const b=directSaleRows([fact(20260909,41000),fact(20260303,39000),fact(20260303,39000),fact(20251001,10000)],table,'A',60);
 assert.deepEqual(mergeSaleSummaries(summarize(a),summarize(b)),summarize([...a,...b]));
});
test('new area is reachable through its member without inventing legacy/comment IDs',()=>{
 const empty=summarize([]),dto={id:'existing',rental:false,displayGroup:{members:[{key:'A',name:'원문 명칭'}],householdScope:{status:'available',roundedAreas:{60:2}}},areas:[]},short={id:'existing',areas:[]};
 const rows=directSaleRows([fact(20191019,41000)],table,'A',60),extra={source:'A',area:60,district:'종로구',summary:summarize(rows)};
 const out=addGroupSaleAreas(dto,short,[extra]);assert.equal(out.dto.id,'existing');assert.equal(out.dto.areas[0].units,2);assert.equal(out.dto.areas[0].total,1);assert.equal(out.short.areas[0].lastFive[0].price,41000);
 const selected=selectApartmentMember(out.dto,'A');assert.equal(selected.areas[0].total,1);assert.equal(selected.areas[0].rows[0].sharedFacts,true);assert.ok(!Object.hasOwn(selected.areas[0].rows[0],'i'));assert.ok(!Object.hasOwn(selected.areas[0].rows[0],'commentId'));assert.deepEqual(dto.areas,[]);assert.equal(empty.total,0);
 assert.throws(()=>addGroupSaleAreas(out.dto,out.short,[extra]),/Duplicate/);
});
test('browser direct reader reuses fact years, preserves actual type and limits by valid trades',async()=>{
 let loads=0;const regional={...table,async regionMonth(code,month){loads++;return{rows:month==='2020-01'?[fact(20200101,200,2)]:[fact(20191019,41000),fact(20191019,41000)]};}};
 const reader=createSaleReader({schema:1,format:'sale-fact-references',facts:{},regions:{}},{months:['2019-10','2020-01'],sources:{}},regional,()=>{throw Error('Direct rows must use existing shared facts');});
 const rows=await reader.rows('A',60,{sharedFacts:true,limit:1});assert.equal(rows.length,3);assert.equal(rows[1].price,41000);assert.equal(rows[1].property,'rowhouse');assert.equal(loads,2);
 assert.deepEqual(await reader.rows('A',60,{sharedFacts:true,year:'2019'}),rows.slice(1));assert.equal(loads,2);
});
