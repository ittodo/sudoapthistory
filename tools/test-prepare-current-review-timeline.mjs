import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {prepareCurrentReviewTimeline,candidateTimelineManifest} from './prepare-current-review-timeline.mjs';
import {prepareCurrentReviewSearch} from './prepare-current-review-search.mjs';
import {startCurrentReviewPreview} from './preview-current-review.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'current-review-timeline-')),baseline=join(root,'site'),candidate=join(root,'_ops/candidate');
  const put=(dir,name,value)=>{const bytes=Buffer.from(JSON.stringify(value)),path=join(dir,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);return hash(bytes);};
  const read=(dir,name)=>JSON.parse(readFileSync(join(dir,name)));
  const oldMap={meta:{sourceVersion:'old-map'},d:[{id:'public-one',n:'옛 이름',g:'종로구',memberSources:[{id:'A'}]}]};
  const oldMapHash=put(baseline,'data/map/index.json',oldMap);
  const map={meta:{sourceVersion:'new-map',candidateOnly:true,approvedOnly:false,contract:'current-review-publication-candidate-v1',sources:{}},d:[{id:'public-one',n:'현재 이름',g:'종로구',coord:[37.5,127],memberSources:[{id:'A'}],pnus:['one','two']}]};
  put(candidate,'data/map/index.json',map);
  put(candidate,'manifest.json',{candidateOnly:true,identityBaseline:{files:{'data/map/index.json':{sha256:oldMapHash}}}});
  put(candidate,'data/index.json',{d:[{as:'A',i:7,a:59,r:1,g:'종로구',n:'원천 이름'}]});
  put(candidate,'data/housing-v3/index.json',{meta:{candidateOnly:true,approvedOnly:false},complexes:[{id:'public-one',name:'현재 이름',housingFamily:'apartment',region:'서울',gu:'종로구',transactionKeys:['A']}]});
  put(candidate,'data/apartments/index.json',{version:2,lookup:{A:['public-one','00'],'public-one':['public-one','00']},ambiguous:[]});
  const authority='data/daily/regions/index.json',identities='data/daily/regions/11110/identities.json',metadata='data/daily/regions/11110/metadata.json';
  const sources={
    [authority]:put(baseline,authority,{schema:3,format:'packed-region',regions:{11110:{identities,metadata}}}),
    [identities]:put(baseline,identities,{complexes:['A'],areas:[[0,'59.1234567']]}),
    [metadata]:put(baseline,metadata,{complexes:[{id:'A',publicId:'public-one',n:'원천 이름',g:'종로구',r:1,hasSale:true,hasRental:true}],areas:[]})
  };
  for(const kind of ['daily','rental'])put(baseline,`data/${kind}/index.json`,{schema:3,version:kind+'-facts-version',sourceRevision:kind+'-source-revision',months:[],minDate:'2006-01-01',maxDate:'2026-10-19',counts:{rows:2},mapVersion:'old-map',sources:{...sources,...(kind==='daily'?{'data/map/index.json':oldMapHash}:{})},regional:{kind,format:'packed-region',authority,quarters:{},states:{}}});
  put(baseline,'data/contracts/index.json',{schema:2,rentalVersion:'rental-facts-version',sources:{},partitions:[]});
  put(baseline,'data/sale-details/index.json',{schema:1,facts:{'source-facts.bin':'unchanged'}});
  prepareCurrentReviewSearch(baseline,candidate);
  return {root,baseline,candidate,map,put,read,close:()=>rmSync(root,{recursive:true,force:true})};
}

test('candidate timeline changes map bindings and search hashes while preserving facts, contracts and IDs',()=>{
  const f=fixture();try{
    const before=Object.fromEntries(['daily','rental'].map(k=>[k,f.read(f.baseline,`data/${k}/index.json`)]));
    const oldSearch=f.read(f.candidate,'data/search/apartments.json'),contracts=readFileSync(join(f.baseline,'data/contracts/index.json')),apartments=readFileSync(join(f.candidate,'data/apartments/index.json'));
    const report=prepareCurrentReviewTimeline(f.baseline,f.candidate);assert.equal(report.transactionFilesRead,0);assert.equal(report.transactionFilesWritten,0);assert.equal(report.written.length,3);
    for(const kind of ['daily','rental']){
      const value=f.read(f.candidate,`data/${kind}/index.json`);assert.equal(value.mapVersion,'new-map');assert.equal(value.sourceRevision,before[kind].sourceRevision);
      const original=structuredClone(before[kind]),actual=structuredClone(value);for(const v of [original,actual]){delete v.mapVersion;delete v.version;delete v.sources['data/map/index.json'];}assert.deepEqual(actual,original);
      assert.deepEqual(f.read(f.baseline,`data/${kind}/index.json`),before[kind]);
    }
    assert.notEqual(f.read(f.candidate,'data/daily/index.json').version,before.daily.version);
    assert.equal(f.read(f.candidate,'data/rental/index.json').version,JSON.parse(contracts).rentalVersion);
    const search=f.read(f.candidate,'data/search/apartments.json');assert.deepEqual(search.apartments,oldSearch.apartments);assert.notEqual(search.version,oldSearch.version);
    for(const kind of ['daily','rental'])assert.equal(search.sources[`data/${kind}/index.json`],hash(readFileSync(join(f.candidate,`data/${kind}/index.json`))));
    assert.deepEqual(readFileSync(join(f.candidate,'data/apartments/index.json')),apartments);assert.deepEqual(readFileSync(join(f.baseline,'data/contracts/index.json')),contracts);
    assert.deepEqual(prepareCurrentReviewTimeline(f.baseline,f.candidate).written,[]);
    const searchBytes=readFileSync(join(f.candidate,'data/search/apartments.json'));assert.equal(prepareCurrentReviewSearch(f.baseline,f.candidate).written,false);assert.deepEqual(readFileSync(join(f.candidate,'data/search/apartments.json')),searchBytes);
    assert.equal(existsSync(join(f.candidate,'data/contracts/index.json')),false);assert.equal(existsSync(join(f.candidate,'data/daily/regions')),false);
  }finally{f.close();}
});

test('candidate guards and unrelated timeline changes fail before any metadata write',()=>{
  for(const change of ['marker','map','baseline','removed-id','changed-fact','search']){
    const f=fixture();try{
      if(change==='marker')f.put(f.candidate,'manifest.json',{candidateOnly:false});
      if(change==='map')f.put(f.candidate,'data/map/index.json',{...f.map,meta:{...f.map.meta,candidateOnly:false}});
      if(change==='baseline')f.put(f.baseline,'data/map/index.json',{meta:{sourceVersion:'changed'},d:[]});
      if(change==='removed-id')f.put(f.candidate,'data/map/index.json',{...f.map,d:[]});
      if(change==='changed-fact'){const v=f.read(f.baseline,'data/daily/index.json');v.counts.rows=3;f.put(f.candidate,'data/daily/index.json',v);}
      if(change==='search'){const v=f.read(f.candidate,'data/search/apartments.json');v.sources['data/daily/index.json']='0'.repeat(64);f.put(f.candidate,'data/search/apartments.json',v);}
      assert.throws(()=>prepareCurrentReviewTimeline(f.baseline,f.candidate),/candidate|baseline|identities|outside map|search/i,change);
      assert.equal(existsSync(join(f.candidate,'data/rental/index.json')),false,change);
    }finally{f.close();}
  }
});

test('search accepts only the exact map-binding overlay and rejects changed source revision',()=>{
  const f=fixture();try{
    prepareCurrentReviewTimeline(f.baseline,f.candidate);
    const daily=f.read(f.candidate,'data/daily/index.json');daily.sourceRevision='forged';f.put(f.candidate,'data/daily/index.json',daily);
    assert.throws(()=>prepareCurrentReviewSearch(f.baseline,f.candidate),/overlay changes a baseline catalog input/);
  }finally{f.close();}
});

test('browser daily client loads the overlay with the current map version and exact served source hashes',async()=>{
  const f=fixture();let server;
  try{
    prepareCurrentReviewTimeline(f.baseline,f.candidate);server=await startCurrentReviewPreview({...f,port:0});const base='http://127.0.0.1:'+server.address().port;
    const fetchLocal=path=>fetch(base+path),context={NodoRegional:globalThis.NodoRegional,NodoVerifiedDataCache:{create:()=>({download:async(path,expected)=>{const bytes=Buffer.from(await(await fetch(base+'/'+path)).arrayBuffer());assert.equal(hash(bytes),expected,path);return bytes;}}),decode:async bytes=>JSON.parse(bytes)}};
    runInNewContext(readFileSync(new URL('../js/daily-client.js',import.meta.url),'utf8'),{window:context,globalThis:context,fetch:fetchLocal,AbortController});
    const client=await context.NodoDailyClient.create(),map=await(await fetchLocal('/data/map/index.json')).json();assert.equal(client.index.mapVersion,map.meta.sourceVersion);assert.equal(client.catalog.complexes[0].id,'A');assert.equal(client.catalog.areas[0][1],'59.1234567');
    const search=await(await fetchLocal('/data/search/apartments.json')).json();for(const kind of ['daily','rental']){const bytes=Buffer.from(await(await fetchLocal(`/data/${kind}/index.json`)).arrayBuffer());assert.equal(hash(bytes),search.sources[`data/${kind}/index.json`]);}
  }finally{if(server)await new Promise(resolve=>server.close(resolve));f.close();}
});

test('linked output directories cannot change files outside the candidate',t=>{
  const f=fixture();try{
    const outside=join(f.root,'outside');mkdirSync(outside);
    try{symlinkSync(outside,join(f.candidate,'data/daily'),process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('Fixture links unavailable');return;}throw error;}
    assert.throws(()=>prepareCurrentReviewTimeline(f.baseline,f.candidate),/Linked timeline path/);assert.equal(existsSync(join(outside,'index.json')),false);
  }finally{f.close();}
});

test('map-only transform retains all other manifest fields',()=>{
  const v={schema:3,version:'facts',sources:{'facts.bin':'a'},regional:{format:'packed-region',kind:'rental'},sourceRevision:'revision',mapVersion:'old',unknown:{retained:true}};
  assert.deepEqual(candidateTimelineManifest(v,'rental','new','a'.repeat(64)),{...v,mapVersion:'new'});
});
