import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,districtFromAddress} from './build-apartment-data.mjs';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import vm from 'node:vm';
import {housingPublicationMode} from './housing-publication-contract.mjs';
import {apartmentShard,apartmentShardValues} from './build-apartment-records.mjs';

// This is an output audit. It does not run in the producer or the browser.
function assertGeneratedScope({index,rows,publications,current,areaUnits=null,readShard}){
 const byRow=new Map(rows.map(r=>[r.i,r])),byPublication=new Map(publications.map(p=>[p.id,p]));
 assert.equal(byRow.size,rows.length,'Source row IDs must be unique');
 if(current){
  const basis='current_hub_apartment_exclusive_units';
  for(const row of rows){
   if(Object.hasOwn(row,'u')){
    assert.ok(areaUnits?.basis===basis&&row.us===basis&&Number.isSafeInteger(row.u)&&row.u>0&&!row.up,
     `${row.i}: unverified area households must not return`);
   }else assert.equal(Object.hasOwn(row,'us'),false,`${row.i}: unknown area must not claim a household source`);
  }
  if(areaUnits){
   assert.equal(areaUnits.basis,basis,'Current household basis');
   assert.equal(areaUnits.rounding,'transaction_round_ties_even','Current household rounding');
   assert.equal(areaUnits.unknownOmitted,true,'Unknown households must be omitted');
   const known=rows.filter(row=>Object.hasOwn(row,'u')).length;
   assert.equal(areaUnits.knownRows,known,'Known household coverage');
   assert.equal(areaUnits.unknownRows,rows.length-known,'Unknown household coverage');
  }
 }
 const owners=new Map();
 for(const p of publications)for(const source of p[current?'transactionClaimKeys':'transactionKeys']||[]){
  if(!owners.has(source))owners.set(source,[]);owners.get(source).push(p.id);
 }
 const seen=new Set(),canonicalIds=new Set();let areas=0;
 for(let n=0;n<256;n++){
  const shard=n.toString(16).padStart(2,'0');
  for(const[id,apt]of Object.entries(readShard(shard))){
   assert.equal(apt.id,id,'DTO key must be its canonical ID');
   assert.deepEqual(index.lookup[id],[id,shard],'Canonical lookup must resolve to its own DTO');
   canonicalIds.add(id);
   const publication=byPublication.get(id),first=byRow.get(apt.areas[0]?.rows[0]?.i);
   assert.equal(apt.units,publication?publication.units??null:current?null:first?.tu??null,`${id}: whole-complex households`);
   for(const area of apt.areas){
    areas++;
    const scope=publication?.displayGroup?.householdScope;
    const expectedAreaUnits=current?(scope?.status==='available'?(scope.roundedAreas[String(area.area)]??null):null):area.rows.length===1?byRow.get(area.rows[0].i)?.u??null:null;
    assert.equal(area.units,expectedAreaUnits,`${id}/${area.area}: area households`);
    for(const row of area.rows){
     if(row.sharedFacts===true){
      assert.ok(publication?.displayGroup?.members.some(m=>m.key===row.source),`${id}: shared source must be a reviewed member`);
      assert.deepEqual(owners.get(row.source),[id],`${id}: shared source has one owner`);
      assert.equal(index.lookup[row.source]?.[0],id,`${id}: shared source alias`);
      assert.ok(!Object.hasOwn(row,'i')&&!Object.hasOwn(row,'commentId'),`${id}: shared source must not invent legacy IDs`);
      assert.ok(!rows.some(r=>r.as===row.source&&r.a===area.area),`${id}: shared area must not duplicate a legacy row`);
      assert.equal(row.units,null);continue;
     }
     const source=byRow.get(row.i);
     assert.ok(source,`${id}: unknown source row ${row.i}`);
     assert.ok(!seen.has(row.i),`Source row ${row.i} cannot belong to two DTOs`);seen.add(row.i);
     assert.equal(row.source,source.as,`${row.i}: stable source ID`);
     assert.equal(area.area,source.a,`${row.i}: display area`);
     assert.equal(row.commentId,'apt_'+source.i,`${row.i}: permanent comment ID`);
     assert.deepEqual(index.legacy[source.i],[id,source.a],`${row.i}: legacy route`);
     assert.equal(index.lookup[source.as]?.[0],id,`${row.i}: source alias owner`);
     const claims=owners.get(source.as)||[];
     assert.equal(id,claims.length===1?claims[0]:source.as,`${row.i}: publication transaction ownership`);
     assert.equal(row.units,current?null:source.u??null,`${row.i}: source area households`);
     if(current){
      if(source.ci)assert.equal(source.ci,id,`${row.i}: published canonical ID`);
     }
    }
   }
  }
 }
 assert.equal(canonicalIds.size,index.count,'All declared canonical DTOs must exist');
 assert.equal(seen.size,rows.length,'Every source row must retain one comment owner');
 assert.equal(Object.keys(index.legacy).length,rows.length,'Every legacy route must retain its source row');
 for(const[alias,[id,shard]]of Object.entries(index.lookup)){
  assert.ok(canonicalIds.has(id),`${alias}: missing canonical DTO`);
  assert.deepEqual(index.lookup[id],[id,shard],`${alias}: canonical shard mismatch`);
 }
 for(const p of publications)assert.equal(index.lookup[p.id]?.[0],p.id,`${p.id}: publication identity`);
 for(const row of rows)if(row.si){
  assert.ok(row.si.includes(row.i),`${row.i}: representative group must include itself`);
  assert.equal(new Set(row.si).size,row.si.length,`${row.i}: duplicate representative member`);
  // Raw siblings precede publication metadata. The home roster rebuilds them
  // from canonical IDs; this file checks that their source rows still exist.
  for(const member of row.si){
   assert.ok(byRow.has(member),`${row.i}: missing representative member ${member}`);
  }
 }
 return {complexes:canonicalIds.size,areas,comments:seen.size};
}

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
test('generated representative and canonical identities preserve household scope and legacy comments',t=>{
 const root=process.env.NODO_TEST_DATA_ROOT?resolve(process.env.NODO_TEST_DATA_ROOT):new URL('../',import.meta.url);
 const file=path=>root instanceof URL?new URL(path,root):join(root,path),index=JSON.parse(readFileSync(file('data/apartments/index.json')));
 const readShard=shard=>{const path=apartmentShard(index,shard);return apartmentShardValues(readFileSync(file(path)),path,index);};
 const read=id=>{const [canonical,shard]=index.lookup[id];return readShard(shard)[canonical];};
 const stock=JSON.parse(readFileSync(file('data/index.json'))),rows=stock.d;
 const housing=JSON.parse(readFileSync(file('data/housing-v3/index.json')));
 const map=JSON.parse(readFileSync(file('data/map/index.json')));
 const current=housingPublicationMode(housing,map)==='current-review';
 const areaUnits=current?stock.meta.reviewCandidate?.areaUnits:null;
 if(current)assert.deepEqual(areaUnits,housing.meta.areaUnits,'Public household metadata must share its current source');
 const source=rows.find(r=>r.as==='41281-3250'&&r.a===85);
 const apt=read(source.as);assert.equal(apt.units,source.tu);assert.equal(apt.areas.find(a=>a.area===85).units,current?null:source.u);
 for(const a of apt.areas)for(const row of a.rows)assert.equal(row.commentId,'apt_'+row.i);
 assert.equal(read('11440-5530').id,'pub_0008933ed9d689371e570144');
 assert.equal(Object.keys(index.shards).length,512);
 for(const complex of map.d)assert.ok(index.lookup[complex.publicationId||complex.id],complex.id);
 for(const source of index.ambiguous)assert.equal(index.lookup[source][0],source,'Ambiguous source must remain independent');
 const report=assertGeneratedScope({index,rows,publications:housing.complexes.filter(p=>p.housingFamily==='apartment'),current,areaUnits,
  readShard});
 t.diagnostic(JSON.stringify({contract:current?'current-review':'legacy',...report}));
});

function scopeFixture(current=true){
 const rows=[{i:0,as:'A',a:85,tu:500,si:[0]},{i:1,as:'B',a:85,tu:700,si:[1]}];
 const apt={id:'canonical',units:1200,areas:[{area:85,units:null,rows:rows.map(r=>({i:r.i,source:r.as,units:null,commentId:'apt_'+r.i}))}]};
 const index={count:1,lookup:{canonical:['canonical','00'],A:['canonical','00'],B:['canonical','00']},legacy:{0:['canonical',85],1:['canonical',85]}};
 const publication={id:'canonical',units:1200,transactionKeys:['A','B'],transactionClaimKeys:['A','B']};
 if(!current){rows[0].u=200;rows[1].u=300;apt.areas[0].rows[0].units=200;apt.areas[0].rows[1].units=300;}
 return {index,rows,publications:[publication],current,apt,readShard:shard=>shard==='00'?{canonical:apt}:{}};
}

test('household audit separates current publication totals from source and area households',()=>{
 const f=scopeFixture();assertGeneratedScope(f);
 f.publications[0].units=null;f.apt.units=null;assertGeneratedScope(f);
 f.apt.units=500;assert.throws(()=>assertGeneratedScope(f),/whole-complex households/);
 f.apt.units=null;f.apt.areas[0].units=1200;assert.throws(()=>assertGeneratedScope(f),/area households/);
 f.apt.areas[0].units=null;f.apt.areas[0].rows[0].units=500;assert.throws(()=>assertGeneratedScope(f),/source area households/);
 f.apt.areas[0].rows[0].units=null;f.rows[0].u=500;assert.throws(()=>assertGeneratedScope(f),/unverified area households/);
 assertGeneratedScope(scopeFixture(false));
});

test('current HUB area counts require explicit provenance, complete counts and matching coverage',()=>{
 const known=()=>{
  const f=scopeFixture();
  f.rows[0].u=200;f.rows[0].us='current_hub_apartment_exclusive_units';
  f.areaUnits={basis:f.rows[0].us,rounding:'transaction_round_ties_even',unknownOmitted:true,knownRows:1,unknownRows:1};
  return f;
 };
 assertGeneratedScope(known());
 for(const mutate of [
  f=>{delete f.rows[0].us;},f=>{f.rows[0].us='legacy';},
  f=>{f.rows[0].u=0;},f=>{f.rows[0].u=1.5;},f=>{f.rows[0].up=true;},
  f=>{f.areaUnits=null;}
 ]){
  const f=known();mutate(f);assert.throws(()=>assertGeneratedScope(f),/unverified area households/);
 }
 const f=known();f.areaUnits.knownRows=2;
 assert.throws(()=>assertGeneratedScope(f),/Known household coverage/);
});

test('identity audit rejects lost comments, moved legacy routes and incorrect canonical owners',()=>{
 const mutations=[
  [f=>f.apt.areas[0].rows[0].commentId='apt_1',/permanent comment ID/],
  [f=>f.index.legacy[0]=['canonical',84],/legacy route/],
  [f=>f.index.lookup.A=['other','00'],/source alias owner/],
  [f=>f.publications[0].transactionClaimKeys=['B'],/publication transaction ownership/],
  [f=>f.apt.areas[0].rows.pop(),/Every source row/],
  [f=>f.rows[0].si=[0,99],/missing representative member/]
 ];
 for(const[mutate,expected]of mutations){const f=scopeFixture();mutate(f);assert.throws(()=>assertGeneratedScope(f),expected);}
});
