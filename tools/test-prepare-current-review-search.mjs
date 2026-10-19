import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import {prepareCurrentReviewSearch} from './prepare-current-review-search.mjs';
import {searchData} from './build-search-data.mjs';
import {startCurrentReviewPreview} from './preview-current-review.mjs';
import {createIndex,search} from '../js/apartment-search-model.js';

const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'current-review-search-')),baseline=join(root,'site'),candidate=join(root,'_ops','candidate');
  const put=(directory,name,value)=>{const bytes=Buffer.from(JSON.stringify(value)),path=join(directory,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);return hash(bytes);};
  const identityPath='data/daily/regions/11110/identities.json',metadataPath='data/daily/regions/11110/metadata.json',authority='data/daily/regions/index.json';
  const identity={complexes:['A','B','R'],areas:[[0,'59.01'],[1,'59.02'],[2,'59.03']]};
  const metadata={complexes:[{id:'A',n:'예전 이름 A',r:1,g:'종로구',d:'청운동',hasSale:true,hasRental:true,publicId:'pub-one'},
    {id:'B',n:'예전 이름 B',r:1,g:'종로구',d:'청운동',hasSale:true,hasRental:false,publicId:'pub-one'},
    {id:'R',n:'전월세 전용',r:1,g:'종로구',d:'청운동',hasSale:false,hasRental:true}],areas:[]};
  const sources={
    [identityPath]:put(baseline,identityPath,identity),[metadataPath]:put(baseline,metadataPath,metadata),
    [authority]:put(baseline,authority,{schema:3,format:'packed-region',regions:{11110:{identities:identityPath,metadata:metadataPath}}})
  };
  for(const kind of ['daily','rental'])put(baseline,`data/${kind}/index.json`,{schema:3,months:[],sources,regional:{format:'packed-region',kind,authority,quarters:{},states:{}}});
  put(candidate,'manifest.json',{candidateOnly:true});
  const index={d:[{as:'A',i:0,a:59,n:'원천 이름 A',r:1,g:'종로구',d:'청운동'},{as:'B',i:8,a:59,n:'원천 이름 B',r:1,g:'종로구',d:'청운동'}]};
  const identities={version:2,lookup:{A:['pub-one','ab'],B:['pub-one','ab'],'pub-one':['pub-one','ab'],'new-no-location':['new-no-location','cd']},ambiguous:[]};
  const boundaryPath='data/map/boundaries/종로구.json',boundaryHash=put(candidate,boundaryPath,{'pub-one':{type:'FeatureCollection',features:[]}});
  put(baseline,boundaryPath,{old:'boundary'});
  const map={meta:{sources:{[boundaryPath]:boundaryHash}},d:[{id:'pub-one',g:'종로구',n:'현재 하나단지',memberSources:[{id:'A'},{id:'B'}],coord:[37.5,127],pnus:['one','two'],boundaryKey:'pub-one',boundarySource:'parcel_union'}]};
  const housing={meta:{candidateOnly:true,approvedOnly:false},complexes:[{id:'pub-one',housingFamily:'apartment',name:'현재 하나단지',region:'서울',gu:'종로구',dong:'청운동',parcels:['one','two']},
    {id:'new-no-location',housingFamily:'apartment',name:'위치 없는 현재 단지',region:'서울',gu:'종로구',dong:'청운동',parcels:[]}]};
  for(const [name,value]of [['data/index.json',index],['data/apartments/index.json',identities],['data/map/index.json',map],['data/housing-v3/index.json',housing]]){
    put(candidate,name,value);put(baseline,name,value);
  }
  // Production search still rejects this marker; fixture has no transaction files.
  put(baseline,'data/index.json',{d:[]});
  put(baseline,'data/housing-v3/index.json',{meta:{approvedOnly:true},complexes:[]});
  return {root,baseline,candidate,put,index,identityPath,metadataPath,housing,boundaryPath,boundaryHash,close:()=>rmSync(root,{recursive:true,force:true})};
}
const catalog=f=>JSON.parse(readFileSync(join(f.candidate,'data/search/apartments.json')));
function get(server,path){
  return new Promise((resolve,reject)=>{
    request({hostname:'127.0.0.1',port:server.address().port,path},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,bytes:Buffer.concat(chunks)}));}).on('error',reject).end();
  });
}

test('candidate search preserves a multi-parcel complex, source rows and metadata-only entries without facts',()=>{
  const f=fixture();try{
    const baselineBefore=readFileSync(join(f.baseline,'data/index.json')),result=prepareCurrentReviewSearch(f.baseline,f.candidate),data=catalog(f);
    assert.equal(result.candidateOnly,true);assert.equal(result.transactionFilesRead,0);assert.equal(result.catalogFilesRead,5);
    assert.equal(result.written,true);assert.equal(data.candidateOnly,true);assert.equal(data.apartments.length,3);
    const one=data.apartments.find(c=>c.id==='pub-one');assert.equal(one.name,'현재 하나단지');
    assert.deepEqual(one.saleIds,['A','B']);assert.deepEqual(one.rows,[0,8]);assert.deepEqual(one.mapIds,['pub-one']);
    assert.deepEqual(one.coord,[37.5,127]);assert.ok(one.aliases.includes('예전 이름 A'));assert.ok(one.aliases.includes('원천 이름 B'));
    assert.ok(one.keys.includes('A'));assert.ok(one.keys.includes('B'));
    assert.equal(data.apartments.filter(c=>c.saleIds.includes('A')||c.saleIds.includes('B')).length,1);
    const missing=data.apartments.find(c=>c.id==='new-no-location');assert.equal(missing.name,'위치 없는 현재 단지');assert.equal(missing.coord,undefined);
    assert.deepEqual(data.apartments.find(c=>c.id==='rental:R').rentalIds,['R']);
    assert.equal(data.sources['data/index.json'],hash(readFileSync(join(f.candidate,'data/index.json'))));
    assert.equal(data.sources[f.boundaryPath],f.boundaryHash);
    assert.notEqual(data.sources['data/index.json'],hash(baselineBefore));
    assert.ok(!Object.keys(data.sources).some(p=>p.startsWith('evidence/')||p==='manifest.json'||p.includes('/quarters/')||p.includes('/states/')));
    assert.equal(prepareCurrentReviewSearch(f.baseline,f.candidate).written,false);
    assert.deepEqual(readFileSync(join(f.baseline,'data/index.json')),baselineBefore);
  }finally{f.close();}
});

test('candidate guards do not change the production approvedOnly gate',()=>{
  const f=fixture();try{
    assert.throws(()=>prepareCurrentReviewSearch(f.baseline,f.baseline),/separate/);
    f.put(f.candidate,'manifest.json',{candidateOnly:false});assert.throws(()=>prepareCurrentReviewSearch(f.baseline,f.candidate),/candidateOnly/);
    f.put(f.candidate,'manifest.json',{candidateOnly:true});f.put(f.candidate,'data/housing-v3/index.json',{...f.housing,meta:{candidateOnly:true,approvedOnly:true}});
    assert.throws(()=>prepareCurrentReviewSearch(f.baseline,f.candidate),/Unapproved candidate/);
    f.put(f.candidate,'data/housing-v3/index.json',f.housing);
    for(const name of ['data/daily/index.json','data/rental/index.json','data/daily/regions/index.json',f.identityPath,f.metadataPath]){
      f.put(f.candidate,name,JSON.parse(readFileSync(join(f.baseline,name))));
    }
    assert.throws(()=>searchData(f.candidate),/Candidate metadata/);
    assert.equal(prepareCurrentReviewSearch(f.baseline,f.candidate).apartments,3);
  }finally{f.close();}
});

test('an overriding catalog cannot claim a baseline hash',()=>{
  const f=fixture();try{
    const metadata=JSON.parse(readFileSync(join(f.baseline,f.metadataPath)));metadata.complexes[0].n='changed overlay';f.put(f.candidate,f.metadataPath,metadata);
    assert.throws(()=>prepareCurrentReviewSearch(f.baseline,f.candidate),/overlay changes a baseline catalog input/);
    assert.equal(existsSync(join(f.candidate,'data/search/apartments.json')),false);
  }finally{f.close();}
});

test('explicit unresolved publications without a location stay searchable without an invented region',()=>{
  const f=fixture();try{
    f.housing.complexes.push({id:'unlocated',housingFamily:'apartment',name:'위치없는행복주택',region:null,gu:null,dong:null,transactionKeys:[],review:{identityUnresolved:true}});
    f.put(f.candidate,'data/housing-v3/index.json',f.housing);
    const report=prepareCurrentReviewSearch(f.baseline,f.candidate),data=catalog(f),entry=data.apartments.find(c=>c.id==='unlocated');
    assert.equal(report.unknownLocationEntries,1);assert.equal(entry.r,null);assert.equal(entry.g,'지역 미확인');assert.equal(entry.locationUnresolved,true);
    const model=createIndex(data);assert.equal(search(model,'위치없는행복주택',{})[0].id,'unlocated');
    assert.equal(search(model,'위치없는행복주택',{r:1}).some(c=>c.id==='unlocated'),false);
    f.housing.complexes.at(-1).review.identityUnresolved=false;f.put(f.candidate,'data/housing-v3/index.json',f.housing);
    assert.throws(()=>prepareCurrentReviewSearch(f.baseline,f.candidate),/Invalid candidate search catalog.*unlocated/);
  }finally{f.close();}
});

test('every catalog source hash matches the actual preview overlay response',async()=>{
  const f=fixture();let server;
  try{
    prepareCurrentReviewSearch(f.baseline,f.candidate);server=await startCurrentReviewPreview({...f,port:0});
    const response=await get(server,'/data/search/apartments.json');assert.equal(response.status,200);
    const data=JSON.parse(response.bytes);
    for(const[path,digest]of Object.entries(data.sources)){
      const served=await get(server,encodeURI('/'+path));assert.equal(served.status,200,path);assert.equal(hash(served.bytes),digest,path);
    }
  }finally{if(server)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));f.close();}
});

test('candidate boundary inputs must exist and match the map digest',()=>{
  const f=fixture();try{
    f.put(f.candidate,f.boundaryPath,{changed:'boundary'});
    assert.throws(()=>prepareCurrentReviewSearch(f.baseline,f.candidate),/Candidate map boundary source mismatch/);
    rmSync(join(f.candidate,f.boundaryPath));
    assert.throws(()=>prepareCurrentReviewSearch(f.baseline,f.candidate),/ENOENT/);
  }finally{f.close();}
});

test('linked candidate output directories are not written',t=>{
  const f=fixture();try{
    const outside=join(f.root,'outside');mkdirSync(outside);
    try{symlinkSync(outside,join(f.candidate,'data','search'),process.platform==='win32'?'junction':'dir');}
    catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('Fixture symlinks unavailable');return;}throw error;}
    assert.throws(()=>prepareCurrentReviewSearch(f.baseline,f.candidate),/Linked search path/);
    assert.equal(existsSync(join(outside,'apartments.json')),false);
  }finally{f.close();}
});
