import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {refreshMetadata} from './refresh-current-review-metadata.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');

function metadataFixture(){
  const root=mkdtempSync(join(tmpdir(),'review-source-continuity-')),baseline=join(root,'baseline'),candidate=join(root,'_ops','candidate');
  const put=(dir,name,value)=>{const b=Buffer.from(JSON.stringify(value)),p=join(dir,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,b);return hash(b);};
  const facts={area:84.97,units:20,rows:[{i:0,source:'old-source',name:'source name',commentId:'apt_0',units:20,metrics:{cagr:3,mdd:-4,sharpe:5,momentum:6,land:2,landKind:'registry',landVerified:20,far:200}}],latest:{date:20261018,price:85000,source:'old-source',row:0},total:4,monthly:{202610:{average:80000,count:4}}};
  const details={
    'pub-one':{id:'pub-one',name:'old',address:'old address',rental:true,areas:[facts],sources:['old-source'],pnus:['old'],map:{boundary:{key:'stale',region:'old'}}},
    other:{id:'other',name:'other',address:'other address',rental:false,areas:[],sources:['taken']},
    missing:{id:'missing',name:'missing',address:'missing address',rental:true,areas:[],sources:[],map:{boundary:{key:'stale',region:'old'}}}
  };
  const index={version:2,count:3,lookup:{},legacy:{0:['pub-one',84.97]},sources:{'data/sale-details/index.json':'a'.repeat(64)},shards:{},ambiguous:[]};
  for(const id of Object.keys(details))index.lookup[id]=[id,hash(id).slice(0,2)];
  index.lookup['old-source']=[...index.lookup['pub-one']];index.lookup.taken=[...index.lookup.other];
  for(let n=0;n<256;n++){
    const shard=n.toString(16).padStart(2,'0'),members=Object.fromEntries(Object.entries(details).filter(([id])=>hash(id).slice(0,2)===shard));
    for(const prefix of ['','summary/']){const name='data/apartments/'+prefix+shard+'.json';index.shards[name]=put(baseline,name,members);}
  }
  put(baseline,'data/apartments/index.json',index);put(candidate,'data/index.json',{d:[]});
  const housing={meta:{candidateOnly:true,approvedOnly:false},complexes:[
    {id:'pub-one',housingFamily:'apartment',name:'current',parcels:['one','two'],tenure:null,transactionKeys:['old-source','new-source','taken','multi'],legacyIds:['new-legacy'],review:{approved:true,identityUnresolved:false}},
    {id:'other',housingFamily:'apartment',name:'other',tenure:'rental',transactionKeys:['taken'],review:{approved:false}},
    {id:'new',housingFamily:'apartment',name:'new',transactionKeys:['multi'],review:{approved:false}}
  ]};
  const boundaryPath='data/map/boundaries/용인수지구.json',boundaryHash=put(candidate,boundaryPath,{'pub-one':{type:'FeatureCollection',features:[]}});
  put(candidate,'data/housing-v3/index.json',housing);put(candidate,'data/map/index.json',{meta:{sources:{[boundaryPath]:boundaryHash}},d:[{id:'pub-one',coord:[37.5,127],g:'용인수지구',boundaryKey:'pub-one',boundarySource:'parcel_union',displayBounds:[[37.4,126.9],[37.6,127.1]]}]});
  const dto=id=>JSON.parse(readFileSync(join(candidate,'data/apartments/'+hash(id).slice(0,2)+'.json')))[id];
  return {root,baseline,candidate,put,index,facts,housing,dto,boundaryPath,boundaryHash,close:()=>rmSync(root,{recursive:true,force:true})};
}
test('metadata refresh preserves exact trade summaries, aliases and comments without transaction files',()=>{
  const root=mkdtempSync(join(tmpdir(),'review-metadata-'));
  try{
    const baseline=join(root,'baseline'),candidate=join(root,'_ops','candidate');
    const put=(dir,name,value)=>{const b=Buffer.from(JSON.stringify(value)),p=join(dir,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,b);return hash(b);};
    const id='41650-30',shard=hash(id).slice(0,2),facts={area:84.97,units:99,rows:[{i:7,source:id,commentId:'apt_7',units:99}],latest:{date:20261018,price:85000},total:4,monthly:{202610:{average:80000,count:4}}};
    const index={version:2,count:1,lookup:{[id]:[id,shard],oldAlias:[id,shard]},legacy:{7:[id,84.97]},sources:{'data/sale-details/index.json':'a'.repeat(64)},shards:{}};
    for(let n=0;n<256;n++){
      const key=n.toString(16).padStart(2,'0');
      for(const prefix of ['','summary/']){
        const name='data/apartments/'+prefix+key+'.json';
        index.shards[name]=put(baseline,name,key===shard?{[id]:{id,name:'기존',address:'주소',areas:[facts],sources:[id],pnus:['wrong']}}:{});
      }
    }
    put(baseline,'data/apartments/index.json',index);
    put(candidate,'data/index.json',{d:[]});
    put(candidate,'data/housing-v3/index.json',{meta:{candidateOnly:true,approvedOnly:false},complexes:[{id,housingFamily:'apartment',name:'현재',parcels:['correct'],units:10,transactionKeys:[id]},{id:'new',housingFamily:'apartment',name:'신규',transactionKeys:['new']}]});
    put(candidate,'data/map/index.json',{d:[{id,coord:[37.4,127.1],scope:'current_review_candidate'}]});
    const result=refreshMetadata(baseline,candidate);
    assert.equal(result.transactionFilesRead,0);assert.equal(result.newMetadataOnlyEntities,1);
    const dto=JSON.parse(readFileSync(join(candidate,'data/apartments/'+shard+'.json')))[id];
    assert.equal(dto.name,'현재');assert.deepEqual(dto.pnus,['correct']);assert.equal(dto.areas[0].area,84.97);
    assert.deepEqual(dto.areas[0].monthly,facts.monthly);assert.deepEqual(dto.areas[0].latest,facts.latest);assert.equal(dto.areas[0].total,4);
    assert.equal(dto.areas[0].rows[0].commentId,'apt_7');assert.equal(dto.areas[0].units,null);
    const next=JSON.parse(readFileSync(join(candidate,'data/apartments/index.json')));
    assert.deepEqual(next.lookup.oldAlias,index.lookup.oldAlias);assert.deepEqual(next.legacy,index.legacy);
    assert.equal(next.sources['data/sale-details/index.json'],index.sources['data/sale-details/index.json']);
    assert.throws(()=>refreshMetadata(baseline,candidate),/already exists/);
    assert.throws(()=>refreshMetadata(baseline,baseline),/separate/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('existing DTOs gain safe source aliases and retain conflicting canonicals, prices and comments',()=>{
  const f=metadataFixture();try{
    const report=refreshMetadata(f.baseline,f.candidate),index=JSON.parse(readFileSync(join(f.candidate,'data/apartments/index.json'))),dto=f.dto('pub-one');
    assert.deepEqual(index.lookup['new-source'],index.lookup['pub-one']);assert.deepEqual(index.lookup['new-legacy'],index.lookup['pub-one']);
    for(const [alias,destination]of Object.entries(f.index.lookup))assert.deepEqual(index.lookup[alias],destination,alias);
    assert.equal(index.lookup.multi,undefined);assert.ok(index.ambiguous.includes('multi'));
    assert.deepEqual(dto.sources,['old-source','new-source']);assert.deepEqual(dto.pnus,['one','two']);
    assert.deepEqual(dto.map.boundary,{key:'pub-one',region:'용인수지구',source:'parcel_union'});assert.equal(f.dto('missing').map.boundary,null);
    assert.deepEqual(dto.map.displayBounds,[[37.4,126.9],[37.6,127.1]]);assert.equal(f.dto('missing').map.displayBounds,null);
    assert.equal(index.sources[f.boundaryPath],f.boundaryHash);
    assert.equal(dto.conflict,true);assert.equal(dto.review.identityUnresolved,true);assert.equal(dto.review.approved,false);
    assert.deepEqual(dto.review.sourceAliasConflicts.map(c=>c.alias).sort(),['multi','taken']);
    assert.equal(dto.review.sourceAliasConflicts.find(c=>c.alias==='taken').existingCanonicalId,'other');
    assert.deepEqual(f.dto('new').sources,[]);assert.equal(f.dto('new').conflict,true);
    assert.deepEqual(dto.areas[0].latest,f.facts.latest);assert.deepEqual(dto.areas[0].monthly,f.facts.monthly);assert.equal(dto.areas[0].total,4);
    assert.equal(dto.areas[0].area,84.97);assert.equal(dto.areas[0].rows[0].i,0);assert.equal(dto.areas[0].rows[0].commentId,'apt_0');
    assert.equal(dto.areas[0].rows[0].metrics.cagr,3);assert.equal(dto.areas[0].rows[0].metrics.land,null);
    assert.deepEqual(index.legacy,f.index.legacy);assert.equal(report.transactionFilesRead,0);assert.equal(report.newAliasesAdded,2);
    assert.equal(report.oldAliasesPreserved,Object.keys(f.index.lookup).length);
  }finally{f.close();}
});

test('rental labels require current evidence in both detail and summary',()=>{
  const f=metadataFixture();try{
    refreshMetadata(f.baseline,f.candidate);
    for(const [id,rental]of [['pub-one',false],['other',true],['missing',false]]){
      assert.equal(f.dto(id).rental,rental,id);
      const summary=JSON.parse(readFileSync(join(f.candidate,'data/apartments/summary/'+hash(id).slice(0,2)+'.json')))[id];
      assert.equal(summary.rental,rental,id);
    }
    assert.equal(f.dto('missing').review.state,'current_target_missing');assert.equal(f.dto('missing').conflict,true);
    assert.deepEqual(f.dto('pub-one').areas[0].latest,f.facts.latest);
  }finally{f.close();}
});
