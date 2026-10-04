import test from'node:test';import assert from'node:assert/strict';
import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,cpSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{createHash}from'node:crypto';
import{GenerationFileSession}from'./housing-generation-batch.mjs';
import{buildHousingRegions}from'./build-housing-regions.mjs';import*as codec from'../js/generated/housing-columns.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('retained DB chain, current revision, cache corruption and identity movement cannot silently reuse',()=>{
 const root=mkdtempSync(join(tmpdir(),'generation-chain-')),cache=join(root,'cache'),output=join(root,'out'),path='data/daily/regions/11110/quarters/2026-Q4.bin';
 mkdirSync(join(output,path,'..'),{recursive:true});writeFileSync(join(output,path),'verified');
 const batch={schema:1,revision:'a',seq:0,batches:[]},identity={11110:{complexes:['A'],areas:[[0,'59.01']]}};
 const session=(o=output,b=batch)=>new GenerationFileSession({site:root,output:o,cache,batch:b,engine:'e'});
 try{
  const first=session();first.save('q',['key'],identity,{rows:1},[path]);const pending=first.finish();cpSync(pending.pending,join(cache,'generation-consumer.json'));
  const other=join(root,'other');mkdirSync(other);assert.ok(session(other).load('q',['key'],identity,p=>p===path,()=>{}));
  assert.equal(session(other).load('q',['key'],{11110:{complexes:['B'],areas:[[0,'59.01']]}},()=>true,()=>{}),null);
  assert.throws(()=>session(other,{...batch,revision:'unrecorded'}),/revision missing/);
  assert.throws(()=>session(other,{schema:1,revision:'b',seq:2,batches:[]}),/not current/);
  const payload=JSON.stringify({schema:1,previousRevision:'wrong',revision:'b',complete:true});
  assert.throws(()=>session(other,{schema:1,revision:'b',seq:1,batches:[{seq:1,payload,digest:hash(payload)}]}),/gap/);
  const incomplete=JSON.stringify({schema:1,previousRevision:'a',revision:'b',complete:false});
  assert.equal(session(other,{schema:1,revision:'b',seq:1,batches:[{seq:1,payload:incomplete,digest:hash(incomplete)}]}).old,null);
  writeFileSync(join(output,path),'damaged');assert.throws(()=>session(other).load('q',['key'],identity,()=>true,()=>{}),/output changed/);
  const receipt=JSON.parse(readFileSync(join(cache,'generation-consumer.json')));receipt.body.seq++;writeFileSync(join(cache,'generation-consumer.json'),JSON.stringify(receipt));assert.throws(()=>session(other),/checkpoint corrupt/);
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('accepted no-change retains quarter/state proofs; correction, changed opening, append and removal match full output',()=>{
 const base=mkdtempSync(join(tmpdir(),'generation-quarter-')),site=join(base,'site'),cache=join(base,'cache'),code='11110';
 const months=['2026-01','2026-02','2026-04','2026-09'],price=Object.fromEntries(months.map(m=>[m,1])),state=structuredClone(price),sources={},calls=[],openingCalls=[];
 const identity={complexes:['old'],areas:[[0,'59.1']]},regions=new Map([[code,{identity,metadata:{complexes:[{id:'old',r:1}],areas:[]}}]]);
 const emit=(p,v)=>{const b=Buffer.from(JSON.stringify(v));mkdirSync(join(site,p,'..'),{recursive:true});writeFileSync(join(site,p),b);sources[p]=hash(b);};
 const readers={regionFingerprint:()=>JSON.stringify([price,state,Object.keys(readers.daily.manifest.regional.bases[code])]),periodFingerprint:(c,ms)=>JSON.stringify(ms.map(m=>[m,price[m],state[m]])),stateFingerprint:(c,ms)=>JSON.stringify(ms.map(m=>[m,state[m]])),verify:()=>{}};
 const rows=(kind,month,opening=false)=>{const date=Number(month.replace('-','')+'01'),p=100+(opening?state[month]:price[month]);return kind==='daily'?(opening?[[code+':0',date,p,p,p,1]]:[[code+':0',date,p,2,0,null,null,null,null,0,'01'.repeat(10),null]]):[[code+':0','59.1',date,p,2,0,3,0,null,null,null,null,null,101,0,null,null,'02'.repeat(10)]];};
 let n=0;const batch=revision=>{if(revision==='before')return{schema:1,seq:0,revision,batches:[]};const payload=JSON.stringify({schema:1,previousRevision:'before',revision,complete:true});return{schema:1,seq:1,revision,batches:[{seq:1,payload,digest:hash(payload)}]};};
 const build=(revision,accept=false,full=false)=>{const output=join(base,'out'+n++),session=full?null:new GenerationFileSession({site,output,cache,batch:batch(revision),engine:'test-engine'});
  const result=buildHousingRegions(site,output,codec,{readers,cacheDir:full?null:cache,generationSession:session});const consumption=session?.finish();if(accept)cpSync(consumption.pending,join(cache,'generation-consumer.json'));
  return{output,result,consumption};};
 const equal=(a,b)=>{for(const kind of ['daily','rental'])assert.equal(hash(readFileSync(join(a.output,'data/'+kind+'/index.json'))),hash(readFileSync(join(b.output,'data/'+kind+'/index.json'))),kind+' exact manifest bytes');};
 try{
  emit('data/map/index.json',{});emit('data/rental/rates.json',{});emit('data/rental/summary.json',{});
  for(const kind of ['daily','rental']){const manifest={schema:2,sources,regional:{bases:{[code]:Object.fromEntries(months.map(m=>[m,true]))}}};emit('data/'+kind+'/index.json',manifest);readers[kind]={manifest,table:{regions},inputs:{},regionMonth(c,m){calls.push(kind+m);return{rows:rows(kind,m),opening:rows(kind,m,true),updates:[]};}};}
  readers.regionOpening=(kind,c,m)=>{openingCalls.push(kind+m);return rows(kind,m,true);};
  build('before',true);const unchanged=build('before',true);assert.equal(unchanged.result.metrics[0].regionReused,true);
  const accepted=JSON.parse(readFileSync(join(cache,'generation-consumer.json')));assert.ok(accepted.body.scopes['quarter/11110/2026-Q1']);assert.ok(accepted.body.scopes['state-year/11110/2026']);
  calls.length=0;price['2026-09']++;const corrected=build('corrected');assert.equal(calls.length,2);assert.equal(openingCalls.length,0);assert.equal(corrected.result.metrics[0].quartersReused,2);equal(corrected,build('corrected',false,true));
  price['2026-04']++;state['2026-09']++;calls.length=0;openingCalls.length=0;const opening=build('state-corrected');assert.equal(calls.length,4);assert.equal(openingCalls.length,4);equal(opening,build('state-corrected',false,true));
  identity.complexes.push('new');identity.areas.push([1,'80.1234']);const appended=build('appended');equal(appended,build('appended',false,true));
  for(const kind of ['daily','rental'])delete readers[kind].manifest.regional.bases[code]['2026-04'];const removed=build('removed');equal(removed,build('removed',false,true));
  const path='data/daily/regions/11110/quarters/2026-Q1.bin';writeFileSync(join(unchanged.output,path),'damaged');price['2026-09']++;assert.throws(()=>build('damaged'),/cached output changed/);
 }finally{rmSync(base,{recursive:true,force:true});}
});

test('exact excluded-sale integer keys survive pending serialization and cannot alias text or numbers',()=>{
 const root=mkdtempSync(join(tmpdir(),'generation-exact-key-')),cache=join(root,'cache'),output=join(root,'out'),other=join(root,'next');
 const path='data/sale-details/11110/excluded.bin',identity={11110:{complexes:['source'],areas:[[0,'59.01']],source:[['source',false]]}};
 mkdirSync(join(output,path,'..'),{recursive:true});mkdirSync(other);writeFileSync(join(output,path),'exact fact bytes');
 const batch={schema:1,revision:'current',seq:0,batches:[]},session=o=>new GenerationFileSession({site:root,output:o,cache,batch,engine:'current'});
 const key=amount=>['sale','11110',[[0,20261001,amount,1,null,4,'ab'.repeat(10)]]];
 try{
  const first=session(output);first.save('sale/11110',key(600001n),identity,{rows:1},[path]);
  const pending=first.finish(),body=JSON.parse(readFileSync(pending.pending)).body;
  assert.match(body.scopes['sale/11110'].key,/^[a-f0-9]{64}$/);cpSync(pending.pending,join(cache,'generation-consumer.json'));
  const next=session(other),emitted=[];assert.deepEqual(next.load('sale/11110',key(600001n),identity,p=>p===path,(p,b)=>emitted.push(b.toString())),{rows:1});
  assert.deepEqual(emitted,['exact fact bytes']);
  for(const amount of [600001,'600001',['bigint','600001'],600002n])assert.equal(session(other).load('sale/11110',key(amount),identity,p=>p===path,()=>{}),null);
  const large=9007199254740993n;first.save('large',key(large),identity,{rows:1},[path]);assert.doesNotThrow(()=>first.finish());
  assert.throws(()=>first.save('invalid',key(Infinity),identity,{},[path]),/finite/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
