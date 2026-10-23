import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {currentReviewContract,housingPublicationMode} from './housing-publication-contract.mjs';
import {buildApartmentData} from './build-apartment-data.mjs';
import {verifyApartmentSale} from './verify-apartment-sale.mjs';
import {searchData} from './build-search-data.mjs';
import {createDataValidationProof,dataValidationProof,proofManifests,proofPath} from './data-validation-proof.mjs';
import {createIndex,search} from '../js/apartment-search-model.js';
import {mapBoundaryReference,mapBoundarySources} from './map-boundary-metadata.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const housingMeta=()=>({contract:currentReviewContract,candidateOnly:false,approvedOnly:false,sourceVersion:'publication-source'});
const mapMeta=()=>({contract:currentReviewContract,candidateOnly:false,sourceVersion:'map-with-final-admin',publicationSourceVersion:'publication-source'});
function fixture(run){
 const root=mkdtempSync(join(tmpdir(),'publication-contract-'));
 const put=(path,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);return hash(bytes);};
 try{return run({root,put});}finally{rmSync(root,{recursive:true,force:true});}
}

test('formal publication requires exact flags and the publication version, while legacy approval stays strict',()=>{
 const housing={meta:housingMeta()},map={meta:mapMeta()};
 assert.equal(housingPublicationMode(housing,map),'current-review');
 assert.notEqual(housing.meta.sourceVersion,map.meta.sourceVersion);
 assert.equal(housingPublicationMode({meta:{approvedOnly:true}},{d:[]}),'legacy');
 for(const [h,m]of [
  [{...housing.meta,candidateOnly:true},map.meta],
  [housing.meta,{...map.meta,candidateOnly:true}],
  [{...housing.meta,candidateOnly:undefined},map.meta],
  [housing.meta,{...map.meta,candidateOnly:undefined}],
  [{...housing.meta,approvedOnly:true},map.meta],
  [{...housing.meta,approvedOnly:undefined},map.meta],
  [{...housing.meta,contract:'current-review-publication-v2'},map.meta],
  [housing.meta,{...map.meta,contract:undefined}],
  [housing.meta,{...map.meta,publicationSourceVersion:'wrong'}],
  [housing.meta,{...map.meta,sourceVersion:undefined}],
  [{approvedOnly:false},{}],
  [{approvedOnly:true,candidateOnly:true},{}]
 ])assert.throws(()=>housingPublicationMode({meta:h},{meta:m}));
});

function preparedDTO({root,put}){
 const housing={meta:housingMeta(),complexes:[{id:'one',review:{approved:false},parcels:['first','second']}]};
 const boundaryPath='data/map/boundaries/종로구.json',boundaryHash=put(boundaryPath,{one:{type:'FeatureCollection',features:[]}});
 const sources={
  [boundaryPath]:boundaryHash,
  'data/index.json':put('data/index.json',{meta:{updated:'2026-10-19'},d:[]}),
  'data/housing-v3/index.json':put('data/housing-v3/index.json',housing),
  'data/map/index.json':put('data/map/index.json',{meta:{...mapMeta(),sources:{[boundaryPath]:boundaryHash}},d:[{id:'one',g:'종로구',pnus:['first','second'],boundaryKey:'one',boundarySource:'parcel_union'}]})
 };
 const dto={one:{id:'one',review:{approved:false},pnus:['first','second'],areas:[{area:84,rows:[{i:9,commentId:'apt_9',metrics:{cagr:1.2}}],latest:{price:120000},monthly:{202610:{average:120000}},total:4}]}};
 const shards={};for(let i=0;i<256;i++)for(const prefix of ['','summary/']){
  const path=`data/apartments/${prefix}${i.toString(16).padStart(2,'0')}.json`;shards[path]=put(path,i===0?dto:{});
 }
 const index={version:2,count:1,sources,shards,lookup:{one:['one','00'],sourceA:['one','00'],sourceB:['one','00']},legacy:{9:['one',84]},ambiguous:[]};
 put('data/apartments/index.json',index);return {housing,index,dto};
}

test('formal apartment build reuses prepared DTOs without changing their storage format',()=>fixture(f=>{
 const {index,dto}=preparedDTO(f),before=readFileSync(join(f.root,'data/apartments/00.json')),beforeIndex=readFileSync(join(f.root,'data/apartments/index.json'));
 const result=buildApartmentData(f.root);assert.equal(result.reused,true);assert.equal(result.verified,false);assert.equal(result.aliases,3);
 assert.deepEqual(readFileSync(join(f.root,'data/apartments/index.json')),beforeIndex);
 for(const[path,digest]of Object.entries(index.shards)){
  assert.equal(hash(readFileSync(join(f.root,path))),digest,'Prepared JSON bytes must be retained');
  assert.equal(existsSync(join(f.root,path.replace(/\.json$/,'.bin'))),false,'Direct reuse must not create BIN siblings');
 }
 assert.deepEqual(readFileSync(join(f.root,'data/apartments/00.json')),before);
 assert.deepEqual(JSON.parse(before),dto);assert.equal(verifyApartmentSale(f.root,{verifiedSales:{status:'PASS'}}).verified,true);
 const boundaryPath='data/map/boundaries/종로구.json',boundaryHash=index.sources[boundaryPath];delete index.sources[boundaryPath];f.put('data/apartments/index.json',index);
 assert.throws(()=>verifyApartmentSale(f.root,{verifiedSales:{status:'PASS'}}),/Missing apartment boundary source/);
 index.sources[boundaryPath]=boundaryHash;f.put('data/apartments/index.json',index);
 f.put('data/map/index.json',{meta:mapMeta(),d:[]});assert.throws(()=>buildApartmentData(f.root),/metadata out of date/);
 index.sources['data/map/index.json']=hash(readFileSync(join(f.root,'data/map/index.json')));index.version=1;f.put('data/apartments/index.json',index);
 assert.throws(()=>buildApartmentData(f.root),/Prepared packed/);assert.throws(()=>verifyApartmentSale(f.root,{verifiedSales:{status:'PASS'}}),/requires packed/);
}));

test('legacy direct writes refuse JSON-to-BIN migration before changing any prepared file',()=>fixture(f=>{
 const {index}=preparedDTO(f);index.version=1;
 f.put('data/housing-v3/index.json',{meta:{approvedOnly:true},complexes:[]});f.put('data/map/index.json',{d:[]});
 const before=f.put('data/apartments/index.json',index);
 assert.throws(()=>buildApartmentData(f.root),/JSON-to-BIN migration requires the official isolated Rust release candidate/);
 assert.equal(hash(readFileSync(join(f.root,'data/apartments/index.json'))),before);
 for(const[path,digest]of Object.entries(index.shards)){
  assert.equal(hash(readFileSync(join(f.root,path))),digest);
  assert.equal(existsSync(join(f.root,path.replace(/\.json$/,'.bin'))),false);
 }
}));

test('apartment integrity verification rejects a candidate even with a successful sale result',()=>fixture(f=>{
 const {housing,index}=preparedDTO(f);housing.meta.candidateOnly=true;index.sources['data/housing-v3/index.json']=f.put('data/housing-v3/index.json',housing);f.put('data/apartments/index.json',index);
 assert.throws(()=>verifyApartmentSale(f.root,{verifiedSales:{status:'PASS'}}),/Candidate metadata/);
}));

function searchFixture(f){
 const complexes=[{id:'A',n:'원천 A',r:1,g:'종로구',d:'청운동',publicId:'one'},{id:'B',n:'원천 B',r:1,g:'종로구',d:'청운동',publicId:'one'}];
 for(const kind of ['daily','rental']){
  const path=`data/${kind}/catalog.bin`,digest=f.put(path,gzipSync(JSON.stringify({complexes:kind==='daily'?complexes:[],areas:[]})));
  f.put(`data/${kind}/index.json`,{schema:1,sources:{[path]:digest}});
 }
 f.put('data/index.json',{d:[]});f.put('data/apartments/index.json',{version:2,lookup:{A:['one','00'],B:['one','00'],one:['one','00']},ambiguous:[]});
 const boundaryPath='data/map/boundaries/종로구.json',boundaryHash=f.put(boundaryPath,{one:{type:'FeatureCollection',features:[]}});
 const map={meta:{...mapMeta(),sources:{[boundaryPath]:boundaryHash}},d:[{id:'one',g:'종로구',n:'현재 하나단지',memberSources:[{id:'A'},{id:'B'}],pnus:['first','second'],boundaryKey:'one',boundarySource:'parcel_union'}]};
 const housing={meta:housingMeta(),complexes:[{id:'one',housingFamily:'apartment',name:'현재 하나단지',region:'서울',gu:'종로구',parcels:['first','second'],review:{approved:false}},
  {id:'unlocated',housingFamily:'apartment',name:'위치없는행복주택',region:null,gu:null,transactionKeys:[],review:{identityUnresolved:true,approved:false}}]};
 f.put('data/map/index.json',map);f.put('data/housing-v3/index.json',housing);return {map,housing};
}

test('formal search preserves multiple parcels as one identity and names with explicitly unknown locations',()=>fixture(f=>{
 searchFixture(f);const data=JSON.parse(searchData(f.root)),one=data.apartments.find(c=>c.id==='one'),missing=data.apartments.find(c=>c.id==='unlocated');
 assert.equal(data.apartments.length,2);assert.deepEqual(one.saleIds,['A','B']);assert.deepEqual(one.mapIds,['one']);
 assert.equal(missing.r,null);assert.equal(missing.g,'지역 미확인');assert.equal(missing.locationUnresolved,true);
 const model=createIndex(data);assert.equal(search(model,'위치없는행복주택',{})[0].id,'unlocated');assert.equal(search(model,'위치없는행복주택',{r:1}).length,0);
 for(const[path,digest]of Object.entries(data.sources))assert.equal(hash(readFileSync(join(f.root,path))),digest);
}));

test('unknown locations require current evidence and are not enabled for legacy or candidates',()=>fixture(f=>{
 const {housing,map}=searchFixture(f);
 housing.complexes[1].review.identityUnresolved=false;f.put('data/housing-v3/index.json',housing);assert.throws(()=>searchData(f.root),/Invalid apartment search/);
 housing.complexes[1].review.identityUnresolved=true;housing.meta.candidateOnly=true;f.put('data/housing-v3/index.json',housing);assert.throws(()=>searchData(f.root),/Candidate metadata/);
 housing.meta={approvedOnly:true};map.meta={sources:map.meta.sources};f.put('data/housing-v3/index.json',housing);f.put('data/map/index.json',map);assert.throws(()=>searchData(f.root),/Invalid apartment search/);
 housing.complexes.pop();f.put('data/housing-v3/index.json',housing);assert.equal(JSON.parse(searchData(f.root)).apartments.length,1);
}));

test('boundary references bind a public map ID to a declared safe regional shard',()=>{
 const row={id:'one',g:'종로구',boundaryKey:'one',boundarySource:'parcel_union'},sources={'data/map/boundaries/종로구.json':'a'.repeat(64)};
 assert.deepEqual(mapBoundaryReference(row),{key:'one',region:'종로구',source:'parcel_union'});
 assert.deepEqual(mapBoundarySources({meta:{sources},d:[row]}),sources);
 assert.throws(()=>mapBoundarySources({d:[row]}),/Missing map boundary source/);
 assert.throws(()=>mapBoundaryReference({...row,g:'../private'}),/Invalid map boundary/);
 assert.throws(()=>mapBoundaryReference({...row,boundaryKey:'other'}),/Invalid map boundary/);
 assert.throws(()=>mapBoundarySources({meta:{sources:{'data/map/boundaries/../../private.json':'a'.repeat(64)}}}),/Invalid map boundary source/);
});

test('formal producer proof preserves current review provenance without a fabricated building audit',()=>fixture(f=>{
 for(const path of proofManifests)f.put(path,{sources:{}});
 const sources={'data/housing-v3/index.json':f.put('data/housing-v3/index.json',{meta:housingMeta(),complexes:[]}),
  'data/map/index.json':f.put('data/map/index.json',{meta:mapMeta(),d:[]})};
 f.put('data/apartments/index.json',{sources});
 const currentReview={contract:currentReviewContract,sourceVersion:'publication-source',housingSha256:sources['data/housing-v3/index.json'],mapSha256:sources['data/map/index.json'],individualApprovals:'preserved_from_workbench'};
 const checks={status:'PASS',schema:3,sales:{status:'PASS',rows:2,excluded:0},details:{status:'PASS',contracts:3,unmatched:0},apartment:{verified:true},currentReview};
 const proof=createDataValidationProof(f.root,checks);assert.deepEqual(proof.checks.currentReview,currentReview);assert.equal(proof.checks.buildingAudit,undefined);
 assert.equal(dataValidationProof(f.root).status,'VERIFIED');assert.equal(dataValidationProof(f.root,{full:true}).status,'FULL_REQUIRED');
 for(const altered of [undefined,{...currentReview,sourceVersion:'wrong'},{...currentReview,individualApprovals:'all_approved'},{...currentReview,mapSha256:'wrong'}])
  assert.throws(()=>createDataValidationProof(f.root,{...checks,currentReview:altered}),/Current review proof/);
 const {digest,...body}=proof;body.checks.currentReview.individualApprovals='all_approved';f.put(proofPath,{...body,digest:hash(JSON.stringify(body))});assert.equal(dataValidationProof(f.root).status,'INVALID');
}));
