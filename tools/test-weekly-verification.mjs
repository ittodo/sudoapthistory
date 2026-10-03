import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,sep} from 'node:path';import {createHash} from 'node:crypto';
import {koreaDate,weekOf,select,record,weeklyEngine,semanticBlobs,importable,importCompletedCi} from './weekly-verification.mjs';
const digest=x=>createHash('sha256').update(x).digest('hex'),sha='a'.repeat(40),engine='b'.repeat(64);
function fixture(fn){const root=mkdtempSync(join(tmpdir(),'weekly-verification-'));
 try{return fn(root);}finally{const path=realpathSync(root),parent=realpathSync(tmpdir());if(!path.startsWith(parent+sep)||!path.slice(parent.length+1).startsWith('weekly-verification-'))throw Error('Unsafe cleanup');rmSync(path,{recursive:true});}}
function evidence(root,overrides={},verifiedOverrides={}){
 const dir=join(root,'cloudflare/dist');mkdirSync(join(dir,'public'),{recursive:true});
 const manifest=JSON.stringify({schema:1,gitSha:sha,files:[]});writeFileSync(join(dir,'public/deployment-manifest.json'),manifest);
 writeFileSync(join(dir,'build-timings.json'),JSON.stringify({gitSha:sha,assetManifestSha256:digest(manifest),fullVerification:true,verificationEngine:engine,producerProof:{status:'FULL_REQUIRED'},...overrides}));
 writeFileSync(join(dir,'verified-release.json'),JSON.stringify({gitSha:sha,assetManifestSha256:digest(manifest),workerVersionId:'production-worker',schemaVersion:2,...verifiedOverrides}));
}
const sunday=new Date('2026-10-03T17:00:00Z'),later=new Date('2026-10-03T18:00:00Z');
test('Korea Sunday boundary, year/month boundaries and invalid dates',()=>{
 assert.equal(koreaDate(new Date('2026-10-03T14:59:59Z')),'2026-10-03');assert.equal(koreaDate(new Date('2026-10-03T15:00:00Z')),'2026-10-04');
 assert.equal(weekOf('2027-01-01'),'2026-12-27');assert.equal(weekOf('2026-10-04'),'2026-10-04');assert.throws(()=>weekOf('2026-02-30'));
});
test('Sunday runs once after actual full build and same SHA public success',()=>fixture(root=>{
 assert.equal(select(root,{now:sunday,engine,event:'push'}).full,true);evidence(root);record(root,{now:later,engine,envFull:true});
 const again=select(root,{now:new Date('2026-10-04T03:00:00Z'),engine,event:'push'});assert.equal(again.full,false);assert.equal(again.reason,'weekly-completed');
 assert.equal(select(root,{now:new Date('2026-10-10T17:00:00Z'),engine,event:'push'}).full,true);
}));
test('failed/incomplete build and public SHA/hash/version mismatch never mark complete',()=>fixture(root=>{
 select(root,{now:sunday,engine,event:'push'});
 for(const [build,publicResult] of [[{fullVerification:false},{}],[{verificationEngine:'changed'},{}],[{producerProof:{status:'VERIFIED'}},{}],[{}, {gitSha:'c'.repeat(40)}],[{}, {assetManifestSha256:'d'.repeat(64)}],[{}, {workerVersionId:'local'}],[{}, {schemaVersion:1}]]){
  evidence(root,build,publicResult);assert.throws(()=>record(root,{now:later,engine,envFull:true}));
  assert.equal(existsSync(join(root,'cloudflare/dist/weekly-verification-v1/completed.json')),false);
 }
 evidence(root);assert.throws(()=>record(root,{now:later,engine,envFull:false}));
 assert.equal(select(root,{now:later,engine,event:'push'}).full,true);
}));
test('corrupt/missing/stale/changed-engine evidence forces Sunday full; manual always full',()=>fixture(root=>{
 select(root,{now:sunday,engine,event:'push'});evidence(root);record(root,{now:later,engine,envFull:true});
 assert.equal(select(root,{now:new Date('2026-10-04T04:00:00Z'),engine:'different',event:'push'}).full,true);
 assert.equal(select(root,{now:new Date('2026-10-04T04:00:00Z'),engine,event:'workflow_dispatch'}).full,true);
 const file=join(root,'cloudflare/dist/weekly-verification-v1/completed.json'),proof=JSON.parse(readFileSync(file));proof.workerVersionId='tampered';writeFileSync(file,JSON.stringify(proof));
 assert.equal(select(root,{now:new Date('2026-10-04T04:00:00Z'),engine,event:'push'}).full,true);
 writeFileSync(file,'broken');assert.equal(select(root,{now:new Date('2026-10-04T04:00:00Z'),engine,event:'push'}).full,true);
 assert.equal(select(root,{now:new Date('2026-10-05T04:00:00Z'),engine,event:'push'}).full,false);
}));
test('selection and ordinary producer receipt cannot masquerade as completed full proof',()=>fixture(root=>{
 const selected=select(root,{now:sunday,engine,event:'push'});const file=join(root,'cloudflare/dist/weekly-verification-v1/completed.json');writeFileSync(file,JSON.stringify(selected));
 assert.equal(select(root,{now:later,engine,event:'push'}).full,true);
 select(root,{now:new Date('2026-10-05T04:00:00Z'),engine,event:'push'});evidence(root);assert.equal(record(root,{now:new Date('2026-10-05T05:00:00Z'),engine,envFull:false}).status,'UNCHANGED');
}));
test('new weekly boundary is not acknowledged by a previous-week full build',()=>fixture(root=>{
 select(root,{now:sunday,engine,event:'push'});evidence(root);assert.throws(()=>record(root,{now:new Date('2026-10-10T17:00:00Z'),engine,envFull:true}),/boundary/);
}));
test('policy engine changes with real calculation/validator code and not data',()=>fixture(root=>{
 mkdirSync(join(root,'tools'));mkdirSync(join(root,'js'));writeFileSync(join(root,'tools/model.mjs'),'first');
 const first=weeklyEngine(root);mkdirSync(join(root,'data'));writeFileSync(join(root,'data/index.json'),'changed input');assert.equal(weeklyEngine(root),first);
 writeFileSync(join(root,'tools/model.mjs'),'second');assert.notEqual(weeklyEngine(root),first);
}));

test('official full CI import binds current engine blobs, week, archive and public same SHA',()=>{
 const manifest={schema:1,gitSha:sha,files:[]},archiveDigest='c'.repeat(64),blobs={'tools/calculation.mjs':'d'.repeat(40)};
 const value={week:'2026-10-04',run:{id:1,name:'Cloudflare Production',head_sha:sha,event:'push',head_branch:'main',status:'completed',conclusion:'success',created_at:'2026-10-03T17:00:00Z',updated_at:'2026-10-03T18:00:00Z'},
  artifact:{id:2,name:'cloudflare-production-'+sha,expired:false,digest:'sha256:'+archiveDigest},archiveDigest,blobs,
  tree:{truncated:false,tree:[{path:'tools/calculation.mjs',type:'blob',sha:blobs['tools/calculation.mjs']}]},
  build:{gitSha:sha,producerProof:{status:'FULL_REQUIRED'},assetManifestSha256:digest(JSON.stringify(manifest)),regionPriceStats:{computedGroups:10,reusedGroups:0}},
  verified:{gitSha:sha,assetManifestSha256:digest(JSON.stringify(manifest)),schemaVersion:2,workerVersionId:'production-worker'},manifest};
 assert.equal(importable(value),true);
 const variants=[x=>x.run.event='workflow_dispatch',x=>x.run.head_branch='staging',x=>x.run.conclusion='failure',x=>x.run.status='in_progress',
  x=>x.run.updated_at='2026-10-11T01:00:00Z',x=>x.artifact.expired=true,x=>x.artifact.digest='sha256:'+'f'.repeat(64),
  x=>x.tree.truncated=true,x=>x.tree.tree[0].sha='changed',x=>x.verified.gitSha='f'.repeat(40),x=>x.verified.assetManifestSha256='f'.repeat(64),
  x=>x.verified.workerVersionId='local',x=>x.build.fullVerification=false,x=>x.build.producerProof.status='MISSING',x=>x.build.regionPriceStats.reusedGroups=1];
 for(const alter of variants){const changed=structuredClone(value);alter(changed);assert.equal(importable(changed),false);}
});
test('local PASS files have no official CI import authority',async()=>{ const root=mkdtempSync(join(tmpdir(),'weekly-verification-')); try {
 const result=await importCompletedCi(root,{token:'',repository:'ittodo/sudoapthistory',engine,request:()=>{throw Error('Should not call API');}});
 assert.equal(result.status,'NOT_IMPORTED');assert.equal(existsSync(join(root,'cloudflare/dist/weekly-verification-v1/completed.json')),false);
 }finally{const path=realpathSync(root),parent=realpathSync(tmpdir());if(!path.startsWith(parent+sep)||!path.slice(parent.length+1).startsWith('weekly-verification-'))throw Error('Unsafe cleanup');rmSync(path,{recursive:true});}
});
