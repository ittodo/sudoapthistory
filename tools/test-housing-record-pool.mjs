import test from 'node:test';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {rebuildRecordPools,rebuildRecordPoolsFast} from './housing-record-pool.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(fn){const output=mkdtempSync(join(tmpdir(),'record-pool-'));try{
 const codes=['11110','28185'],bytes={},data={},calls=[];const readers={};
 for(const kind of ['daily','rental']){
  const table={regions:new Map()},quarters={},sources={},inputs={};
  for(const code of codes){const id=`data/daily/regions/${code}/identities.json`;bytes[id]='identity';sources[id]=hash(bytes[id]);table.regions.set(code,{entry:{identities:id}});quarters[code]={};
   for(const [month,q]of [['2026-09','2026-Q3'],['2026-10','2026-Q4']]){const p=`data/daily/regions/${code}/quarters/${q}.bin`;bytes[p]??='facts';sources[p]=hash(bytes[p]);quarters[code][month]=p;const row=kind==='daily'?[code+':0',20260901,100,2,0,null,null,null,null,0,'01'.repeat(10),null]:[code+':0','59.001',20260901,100,2,0,3,0,null,null,null,null,null,101,0,null,null,'02'.repeat(10)];data[kind+code+month]=[row,row.slice()];}
  }
  readers[kind]={manifest:{schema:3,version:'global-version',regional:{quarters},sources},table,inputs,physical(p){const sha256=hash(bytes[p]);if(sources[p]!==sha256)throw Error('source mismatch');inputs[p]=sha256;return {sha256};},regionMonth(code,month){calls.push(kind+code+month);return {rows:data[kind+code+month]};}};
 }
 const update=p=>{bytes[p]+='changed';for(const r of Object.values(readers)){r.manifest.sources[p]=hash(bytes[p]);delete r.inputs[p];}};
 await fn({output,readers,calls,bytes,data,update,run:options=>rebuildRecordPools('unused',output,{readers,...options})});
}finally{rmSync(output,{recursive:true,force:true});}}
test('unrelated region, metadata and global version leave old regional pool hashes stable',()=>fixture(({output,readers,calls,run,update})=>{
 const first=run();assert.equal(first.rebuiltRegions,2);assert.equal(calls.length,8);const old=readFileSync(join(output,'11110/index.json'));
 calls.length=0;for(const r of Object.values(readers)){r.manifest.version='new version';r.metadata='changed';}
 assert.equal(run().reusedRegions,2);assert.equal(calls.length,0);assert.deepEqual(readFileSync(join(output,'11110/index.json')),old);
 update('data/daily/regions/28185/quarters/2026-Q4.bin');const changed=run();assert.equal(changed.rebuiltRegions,1);assert.equal(calls.length,2);assert.equal(changed.metrics[1].reusedQuarters,1);assert.deepEqual(readFileSync(join(output,'11110/index.json')),old);
 const rows=JSON.parse(gunzipSync(readFileSync(join(output,'11110/2026-09-rental.bin'))));assert.equal(rows.length,2);assert.equal(rows[0][0][1],'59.001');assert.deepEqual(rows[0],rows[1]);
}));
test('damaged cached bytes rebuild only damaged quarter; full mode never reuses',()=>fixture(({output,calls,run})=>{
 run();calls.length=0;writeFileSync(join(output,'11110/2026-09-daily.bin'),'damaged');const result=run();assert.equal(result.rebuiltRegions,1);assert.equal(calls.length,2);assert.equal(result.metrics[0].rebuiltQuarters,1);assert.equal(result.metrics[0].reusedQuarters,1);
 calls.length=0;assert.equal(run({full:true}).reusedRegions,0);assert.equal(calls.length,8);
}));
test('current source corruption is blocked even when cached outputs are valid',()=>fixture(({bytes,run})=>{
 run();bytes['data/daily/regions/11110/quarters/2026-Q3.bin']='corrupt';assert.throws(()=>run(),/source mismatch/);
}));

test('parallel byte checks retain duplicate identities and exact sequential pool bytes',()=>fixture(async({output,readers,run,calls})=>{
 run();const before=readFileSync(join(output,'11110/index.json'));calls.length=0;
 const value=await rebuildRecordPoolsFast('unused',output,{readers});
 assert.equal(value.reusedRegions,2);assert.equal(calls.length,0);assert.deepEqual(readFileSync(join(output,'11110/index.json')),before);
 assert.equal(value.parallelOutputChecks.files,8);assert.equal(value.parallelOutputChecks.threads,4);
 writeFileSync(join(output,'11110/2026-09-daily.bin'),'damaged');calls.length=0;
 const fixed=await rebuildRecordPoolsFast('unused',output,{readers});
 assert.equal(fixed.rebuiltRegions,1);assert.equal(calls.length,2);
 const full=await rebuildRecordPoolsFast('unused',output,{readers,full:true});assert.equal(full.reusedRegions,0);
}));
test('mutation after parallel preflight cannot authorize cached pool reuse',()=>fixture(async({output,readers,run,calls})=>{
 run();calls.length=0;let changed=false;
 const value=await rebuildRecordPoolsFast('unused',output,{readers,onProgress:metric=>{
  if(metric.code==='11110'&&!changed){changed=true;writeFileSync(join(output,'28185/2026-09-daily.bin'),'damaged');}
 }});
 assert.equal(value.metrics[1].reused,false);assert.equal(value.metrics[1].rebuiltQuarters,1);assert.equal(calls.length,2);
}));

test('parallel verifier works from an inline module without inheriting eval options',()=>fixture(({output,run})=>{
 run();const module=new URL('./housing-pool-verifier.mjs',import.meta.url).href;
 const script='import{verifyPoolFiles}from '+JSON.stringify(module)+';const rows=JSON.parse(process.argv[2]);const c=await verifyPoolFiles(process.argv[1],rows);if(!c.valid(...rows[0]))process.exit(2);';
 const index=JSON.parse(readFileSync(join(output,'11110/index.json'))),entry=Object.entries(index.files)[0];
 const value=spawnSync(process.execPath,['--input-type=module','-e',script,output,JSON.stringify([['11110',...entry]])],{encoding:'utf8'});
 assert.equal(value.status,0,value.stderr);
}));
