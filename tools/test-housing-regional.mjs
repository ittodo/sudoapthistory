import {execFileSync} from 'node:child_process';
import{test}from'node:test';import assert from'node:assert/strict';import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync}from'node:fs';import{tmpdir}from'node:os';import{join,sep}from'node:path';import{gzipSync,gunzipSync}from'node:zlib';import{createHash}from'node:crypto';
import*as codec from'../js/generated/housing-columns.mjs';import{packQuarter,encodeQuarter}from'../js/housing-quarter.mjs';import{packStateTimeline,encodeStateFile}from'../js/housing-state-timeline.mjs';import{create}from'../js/housing-regional.mjs';import{regionalReader}from'./regional-data.mjs';import{createHousingDecodeCache}from'./housing-regional-reader.mjs';
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
   const decodeCache=createHousingDecodeCache(),node=regionalReader(root,kind,{decodeCache}),load=async path=>{const bytes=readFileSync(join(root,path));assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sources[path]);return path.endsWith('.bin')?new Uint8Array(gunzipSync(bytes)):JSON.parse(bytes);};const browser=await create(manifest,kind,load);
   const requested=[];const scoped=await create(manifest,kind,async path=>{requested.push(path);return load(path);},{codes:['11110']});assert.deepEqual(await scoped.regionMonth('11110','2026-09',false,false),{...originals['11110'][kind],opening:[]});assert.ok(requested.every(p=>!p.includes('/28185/')));await assert.rejects(scoped.regionMonth('28185','2026-09'),/Unknown region/);
   for(const code of Object.keys(regions)){assert.deepEqual(node.regionMonth(code,'2026-09'),originals[code][kind]);assert.deepEqual(await browser.regionMonth(code,'2026-09'),originals[code][kind]);}
   const path=kind==='daily'?'data/daily/1/2026-09-state.bin':'data/rental/months/2026-09-11-state.bin';assert.deepEqual(await browser.shard(path,'2026-09',1),node.read(path));assert.equal(node.read(path).rows.length,1);const fullState=node.read(path),mapState=node.readMapState(path);assert.deepEqual(mapState,{...fullState,rows:[]});assert.throws(()=>node.readMapState(path.replace('-state','')),/Map state path/);
   assert.ok(decodeCache.stats.hits>0);const quarter=join(root,quarters['11110']['2026-09']),saved=readFileSync(quarter);writeFileSync(quarter,Buffer.concat([saved,Buffer.from('changed')]));assert.throws(()=>node.readMapState(path),/Regional source mismatch/);writeFileSync(quarter,saved);
  }
 const module=new URL('./regional-data.mjs',import.meta.url).href;
  const check=()=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {verifyRegionalData} from ${JSON.stringify(module)};console.log(JSON.stringify(verifyRegionalData(${JSON.stringify(root)},'daily')));`],{encoding:'utf8'}));
  assert.deepEqual(check().validation,{checked:2,reused:0});assert.deepEqual(check().validation,{checked:0,reused:2});
  const metadata='data/daily/regions/11110/metadata.json';const changed=Buffer.from(JSON.stringify({complexes:[{id:'11110source',n:'changed name',r:1}],areas:[]}));writeFileSync(join(root,metadata),changed);const digest=createHash('sha256').update(changed).digest('hex');
  for(const kind of ['daily','rental']){const path=join(root,'data/'+kind+'/index.json'),manifest=JSON.parse(readFileSync(path));manifest.sources[metadata]=digest;writeFileSync(path,JSON.stringify(manifest));}
  assert.deepEqual(check().validation,{checked:0,reused:2});
 }finally{const target=realpathSync(root),parent=realpathSync(tmpdir());if(!target.startsWith(parent+sep)||!target.slice(parent.length+1).startsWith('housing-regional-'))throw Error('Unsafe test cleanup');rmSync(target,{recursive:true,force:true});}
});

import{scopedNativeMonth}from'./housing-native-adapter.mjs';
test('native local IDs acquire only their own region namespace without changing exact values',()=>{
 const m={rows:[[0,'59.0001',20260901,100.25,null]],opening:[[9,20260830]],updates:[[0,20260901]]},copy=structuredClone(m);
 assert.deepEqual(scopedNativeMonth('11110',m),{rows:[['11110:0','59.0001',20260901,100.25,null]],opening:[['11110:9',20260830]],updates:[['11110:0',20260901]]});assert.deepEqual(m,copy);assert.equal(scopedNativeMonth('28185',m).rows[0][0],'28185:0');
 for(const bad of [-1,1.5,'11110:0',4294967296])assert.throws(()=>scopedNativeMonth('11110',{...m,rows:[[bad]]}),/native local identity/);assert.throws(()=>scopedNativeMonth('11',m),/native region/);
});


test('decoded cache has byte and entry limits, LRU eviction and no retained oversize inputs',()=>{
 const cache=createHousingDecodeCache({maxBytes:96,maxEntries:2}),a={a:true},b={b:true};
 cache.set('a',a,2);cache.set('b',b,2);assert.equal(cache.get('a'),a);
 cache.set('c',{c:true},2);assert.equal(cache.get('b'),undefined);assert.equal(cache.get('a'),a);
 assert.equal(cache.stats.retainedEstimatedBytes,96);assert.equal(cache.stats.peakRetainedEstimatedBytes,96);assert.equal(cache.stats.evictions,1);
 cache.set('large',{},5);assert.equal(cache.get('large'),undefined);assert.equal(cache.stats.oversize,1);
 const disabled=createHousingDecodeCache({maxBytes:0});disabled.set('no',{},1);assert.equal(disabled.get('no'),undefined);
 for(const options of [{maxBytes:-1},{maxEntries:1.5}])assert.throws(()=>createHousingDecodeCache(options),/budget/);
 assert.throws(()=>cache.set('invalid',{},NaN),/size/);assert.throws(()=>cache.set('invalid',{},1,0),/estimate/);
 const packed=createHousingDecodeCache({maxBytes:100});packed.set('packed-state',{},1000,64);assert.ok(packed.get('packed-state'));assert.equal(packed.stats.retainedEstimatedBytes,64);
});

test('assembled province months survive district cache churn and share pending reads',async()=>{
 const sources={},regions={},quarters={},states={},files=new Map(),requested=[],promoted=[];
 const months=Array.from({length:7},(_,i)=>'2026-'+String(i+1).padStart(2,'0'));
 function emit(path,value,binary=false){const bytes=binary?gzipSync(value):Buffer.from(JSON.stringify(value));files.set(path,bytes);sources[path]=createHash('sha256').update(bytes).digest('hex');}
 // More districts than the decoded file cache can retain.
 for(let i=0;i<15;i++){
  const code=String(11000+i),base='data/daily/regions/'+code,identity={complexes:[code+'source'],areas:[[0,'59.1']]};
  emit(base+'/identities.json',identity);emit(base+'/metadata.json',{complexes:[{id:code+'source',n:'단지',r:1}],areas:[]});
  regions[code]={identities:base+'/identities.json',metadata:base+'/metadata.json'};quarters[code]={};states[code]={};
  const inputs={},opening={};
  for(const month of months){
   const day=Number(month.replace('-','')+'01'),row=[code+':0',day,100,2,0,null,null,null,null,0,'01'.repeat(11),null];
   inputs[month]={daily:{rows:[row],updates:[[code+':0',day,100,100,100,1]],opening:[]},rental:{rows:[],updates:[],opening:[]}};
   opening[month]=[[code+':0',20251231,90,90,90,1]];
   quarters[code][month]=base+'/quarters/2026-Q'+Math.ceil(Number(month.slice(5))/3)+'.bin';
   states[code][month]=base+'/states/daily/2026.bin';
  }
  for(const q of [1,2,3])emit(base+'/quarters/2026-Q'+q+'.bin',encodeQuarter(packQuarter(code,'2026-Q'+q,Object.fromEntries(Object.entries(inputs).filter(([m])=>Math.ceil(Number(m.slice(5))/3)===q)),identity,codec)),true);
  emit(base+'/states/daily/2026.bin',encodeStateFile(packStateTimeline(code,'daily',opening,codec)),true);
 }
 emit('data/daily/regions/index.json',{schema:3,regions});
 const manifest={schema:3,months,sources,regional:{format:'packed-region',kind:'daily',authority:'data/daily/regions/index.json',quarters,states}};
 let failure;
 const load=async path=>{requested.push(path);if(path===failure){failure=null;throw Error('temporary download');}const bytes=files.get(path);return path.endsWith('.bin')?new Uint8Array(gunzipSync(bytes)):JSON.parse(bytes);};
 load.promote=p=>promoted.push(p);
 const browser=await create(manifest,'daily',load),get=(m,state=true,background=false)=>browser.shard('probe/'+m+(state?'-state':'')+'.bin',m,1,background);
 const before=requested.length,[first,shared]=await Promise.all([get(months[0],true,true),get(months[0])]);
 assert.equal(first,shared);assert.equal(requested.length-before,30,'one read per district quarter/state');
 assert.equal(first.opening.length,15);assert.ok(promoted.length>0,'foreground claims shared downloads');
 assert.equal(await get(months[0]),first);assert.equal(requested.length-before,30,'same-month seeks never reread evicted district files');
 const rows=await get(months[0],false);assert.equal(rows.opening.length,0);assert.deepEqual(rows.rows,first.rows);
 for(const month of months.slice(1,6))await get(month);
 const beforeEvicted=requested.length;assert.deepEqual(await get(months[0]),first);assert.ok(requested.length>beforeEvicted,'old assembled months are evicted');
 failure=quarters['11000'][months[6]];
 await assert.rejects(get(months[6]),/temporary download/);
 assert.equal((await get(months[6])).rows.length,15,'failed month remains retryable');
});
