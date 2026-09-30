import{test}from'node:test';import assert from'node:assert/strict';import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync}from'node:fs';import{tmpdir}from'node:os';import{join,sep}from'node:path';import{gzipSync,gunzipSync}from'node:zlib';import{createHash}from'node:crypto';
import*as codec from'../js/generated/housing-columns.mjs';import{packQuarter,encodeQuarter}from'../js/housing-quarter.mjs';import{packStateTimeline,encodeStateFile}from'../js/housing-state-timeline.mjs';import{create}from'../js/housing-regional.mjs';import{regionalReader}from'./regional-data.mjs';
test('browser and Node schema 3 readers share scoped facts, map states and source IDs',async()=>{
 const root=mkdtempSync(join(tmpdir(),'housing-regional-')),sources={},regions={},quarters={},states={},originals={};
 try{
  function emit(path,value,binary=false){const bytes=binary?gzipSync(value):Buffer.from(JSON.stringify(value));mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),bytes);sources[path]=createHash('sha256').update(bytes).digest('hex');}
  for(const[code,province]of [['11110',1],['28185',2]]){
   const identity={complexes:[code+'source'],areas:[[0,'59.1']]},metadata={complexes:[{id:code+'source',n:'동일한 이름',r:province}],areas:[]};
   const sale=[code+':0',20260901,100,2,0,null,null,null,null,0,'01'.repeat(11),null],rent=[code+':0','59.1',20260901,100,2,0,3,0,null,null,null,null,null,101,0,null,null,'02'.repeat(10)];
   const months={'2026-09':{daily:{rows:[sale],updates:[[code+':0',20260901,100,100,100,1]],opening:[]},rental:{rows:[rent],updates:[rent],opening:[]}}};originals[code]=months['2026-09'];
   const base=`data/daily/regions/${code}`,q=base+'/quarters/2026-Q3.bin';emit(q,encodeQuarter(packQuarter(code,'2026-Q3',months,identity,codec)),true);quarters[code]={'2026-09':q};
   emit(base+'/identities.json',identity);emit(base+'/metadata.json',metadata);regions[code]={identities:base+'/identities.json',metadata:base+'/metadata.json'};
   states[code]={};for(const kind of ['daily','rental']){const p=base+'/states/'+kind+'/2026.bin';if(code==='11110'){states[code][kind]=null;}else{emit(p,encodeStateFile(packStateTimeline(code,kind,{'2026-09':[]},codec)),true);states[code][kind]=p;}}
  }
  emit('data/daily/regions/index.json',{schema:3,regions});
  for(const kind of ['daily','rental']){
   const manifest={schema:3,months:['2026-09'],sources:Object.fromEntries(Object.entries(sources).filter(([p])=>!p.includes('/states/'+(kind==='daily'?'rental':'daily')+'/')&&!/^data\/(daily|rental)\/index.json$/.test(p))),regional:{format:'packed-region',kind,authority:'data/daily/regions/index.json',quarters,states:Object.fromEntries(Object.entries(states).map(([c,s])=>[c,{'2026-09':s[kind]}]))}};emit(`data/${kind}/index.json`,manifest);
   const node=regionalReader(root,kind),load=async path=>{const bytes=readFileSync(join(root,path));assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sources[path]);return path.endsWith('.bin')?new Uint8Array(gunzipSync(bytes)):JSON.parse(bytes);};const browser=await create(manifest,kind,load);
   for(const code of Object.keys(regions)){assert.deepEqual(node.regionMonth(code,'2026-09'),originals[code][kind]);assert.deepEqual(await browser.regionMonth(code,'2026-09'),originals[code][kind]);}
   const path=kind==='daily'?'data/daily/1/2026-09-state.bin':'data/rental/months/2026-09-11-state.bin';assert.deepEqual(await browser.shard(path,'2026-09',1),node.read(path));assert.equal(node.read(path).rows.length,1);
  }
 }finally{const target=realpathSync(root),parent=realpathSync(tmpdir());if(!target.startsWith(parent+sep)||!target.slice(parent.length+1).startsWith('housing-regional-'))throw Error('Unsafe test cleanup');rmSync(target,{recursive:true,force:true});}
});
