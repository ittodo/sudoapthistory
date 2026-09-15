import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,districtFromAddress} from './build-apartment-data.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('metadata-only apartments keep district filters separate from neighborhood names',()=>{
 assert.equal(districtFromAddress('서울 강남구 역삼동 123'),'강남구');
 assert.equal(districtFromAddress('경기 고양시 덕양구 지축동 123'),'고양시 덕양구');
 assert.equal(districtFromAddress('경기 양평군 양평읍 123'),'양평군');
});
test('recent average expands within the latest year, excludes cancelled and missing trades',()=>{
 const tx=(date,price,flags=0)=>({date,price,flags,row:0,order:0});
 const result=summarize([tx(20260911,84500),tx(20260830,87000),tx(20260821,85000),tx(20260915,999999,2),tx(20260914,888888,4),tx(20250101,50000)]);
 assert.equal(result.latest.price,84500);assert.deepEqual(result.recent,{value:85500,count:3,from:202608,to:202609});assert.equal(result.monthly['202609'].count,1);
 assert.equal(summarize([tx(20260901,10000),tx(20250101,20000)]).recent.count,1);
 assert.equal(summarize([tx(20260901,10000,2)]).latest,null);
});
test('detail links preserve source IDs and zero-valued legacy row IDs',()=>{
 const context={window:{addEventListener(){}},URLSearchParams,matchMedia:()=>({matches:false,addEventListener(){}}),document:{readyState:'loading',addEventListener(){}}};vm.runInNewContext(readFileSync(new URL('../js/apartment-links.js',import.meta.url),'utf8'),context);
 assert.equal(context.window.NodoApartmentLinks.url({row:0,area:59,tab:'trades'}),'/apartment/?row=0&area=59&tab=trades');
 assert.equal(context.window.NodoApartmentLinks.url({id:'41281-3250',area:85}),'/apartment/?id=41281-3250&area=85&tab=overview');
});
test('generated representative and canonical identities preserve household scope and legacy comments',()=>{
 const base=new URL('../data/apartments/',import.meta.url),index=JSON.parse(readFileSync(new URL('index.json',base)));
 const read=id=>{const [canonical,shard]=index.lookup[id];return JSON.parse(readFileSync(new URL(shard+'.json',base)))[canonical];};
 const source=JSON.parse(readFileSync(new URL('../data/index.json',import.meta.url))).d.find(r=>r.as==='41281-3250'&&r.a===85);
 const apt=read(source.as);assert.equal(apt.units,source.tu);assert.equal(apt.areas.find(a=>a.area===85).units,source.u);
 for(const a of apt.areas)for(const row of a.rows)assert.equal(row.commentId,'apt_'+row.i);
 assert.equal(read('11440-5530').id,'pub_0008933ed9d689371e570144');
 assert.equal(Object.keys(index.shards).length,512);
 const map=JSON.parse(readFileSync(new URL('../data/map/index.json',import.meta.url)));
 for(const complex of map.d)assert.ok(index.lookup[complex.publicationId||complex.id],complex.id);
 for(const source of index.ambiguous)assert.equal(index.lookup[source][0],source,'Ambiguous source must remain independent');
});
