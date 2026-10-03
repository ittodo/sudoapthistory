import test from'node:test';import assert from'node:assert/strict';
import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,cpSync,readdirSync,existsSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{createHash}from'node:crypto';
import{buildHousingRegions}from'./build-housing-regions.mjs';import{buildHousingSales}from'./build-housing-sales.mjs';import{buildHousingDetails}from'./build-housing-details.mjs';
import{detailMemo}from'./housing-detail-cache.mjs';import*as codec from'../js/generated/housing-columns.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function detailFixture(base){
 const source=join(base,'source'),seed=join(base,'seed'),cache=join(base,'cache');mkdirSync(source);const sources={};
 const put=(p,v)=>{const b=Buffer.from(JSON.stringify(v));mkdirSync(join(source,p,'..'),{recursive:true});writeFileSync(join(source,p),b);sources[p]=hash(b);};
 const months=['2025-09','2026-09'],rows=Object.fromEntries(months.map(m=>[m,Array.from({length:2},()=>({aptSeq:'A',area:59.001,buildYear:1991,cancelDate:'',cancelled:false,category:'monthly',contractTerm:'26.09~28.08',contractType:'갱신',date:m+'-01',deposit:10000.25,dong:'동',entityId:'A',floor:-1,identityStatus:'source',jibun:'91',kind:'rent',monthlyRent:100.25,name:'이름',previousDeposit:9000.25,previousMonthlyRent:null,price:null,property:'apartment',renewalRight:'사용'}))]));
 const partitions=months.map(m=>({service:'apartment-rent',lawd:'11110',month:m.replace('-',''),path:'apartment-rent/11110/'+m.replace('-','')+'.json',count:2}));
 put('data/contracts/index.json',{schema:1,partitions});for(const[m,r]of Object.entries(rows))put('data/contracts/apartment-rent/11110/'+m.replace('-','')+'.json',{rows:r});
 put('data/tx/g.json',{entries:{entry:{2025:[[9,1,60000,2,0,''],[9,1,60000,2,0,'']],2026:[[9,1,60000,2,0,''],[9,1,60000,2,0,'']]}}});
 put('data/index.json',{d:[{as:'A',g:'g',i:'entry',a:59}]});put('data/apartments/index.json',{sources:{'data/tx/g.json':sources['data/tx/g.json']}});
 put('data/apartment-rent/index.json',{unit:'만원',total:4,linked:4,records:{A:{shard:'old',hasRental:true}},coverage:{},shards:{}});
 put('data/map/index.json',{meta:{sources:{'data/tx/g.json':sources['data/tx/g.json']},sourceVersion:'initial'},d:[]});put('data/rental/rates.json',{});put('data/rental/summary.json',{});
 const regions=new Map([['11110',{identity:{complexes:['A'],areas:[[0,'59.001']]},metadata:{complexes:[{id:'A',n:'이름',r:1,hasSale:true}],areas:[]}}]]),readers={verify:()=>{}};
 for(const kind of ['daily','rental']){
  const manifest={schema:2,months,sources,regional:{bases:{11110:Object.fromEntries(months.map(m=>[m,true]))}}};put('data/'+kind+'/index.json',manifest);
  readers[kind]={manifest,table:{regions},inputs:{},regionMonth(code,m){const date=Number(m.replace('-','')+'01'),id=m.startsWith('2025')?'01'.repeat(10):'02'.repeat(10);
   const sale=[code+':0',date,60000,2,0,null,null,null,null,0,id,null],rent=[code+':0','59.001',date,10000.25,100.25,2,-1,0,null,null,null,null,null,101,0,null,null,id];
   return{rows:[kind==='daily'?sale:rent,kind==='daily'?sale:rent],opening:[],updates:[]};
  }};
 }
 buildHousingRegions(source,seed,codec,{readers});let n=0;
 const run=(cached=true)=>{const out=join(base,'out'+n++);cpSync(seed,out,{recursive:true});const sales=buildHousingSales(source,out,[],{cacheDir:cached?cache:null}),rental=buildHousingDetails(source,out,null,{cacheDir:cached?cache:null});return{out,sales,rental};};
 const compare=(a,b)=>{for(const p of ['data/sale-details/index.json','data/contracts/index.json','data/apartment-rent/index.json','data/daily/index.json','data/apartments/index.json','data/map/index.json'])assert.deepEqual(readFileSync(join(a.out,p)),readFileSync(join(b.out,p)));
  for(const m of [JSON.parse(readFileSync(join(a.out,'data/sale-details/index.json'))),JSON.parse(readFileSync(join(a.out,'data/contracts/index.json')))])for(const p of Object.keys(m.sources)){assert.deepEqual(readFileSync(join(a.out,p)),readFileSync(join(b.out,p)));}
 };
 return{source,seed,cache,put,run,compare,rows,partitions};
}
test('real detail builders reuse unchanged scopes; cancellation, display and duplicate removal regenerate only affected scope',()=>{
 const base=mkdtempSync(join(tmpdir(),'detail-reuse-')),old=process.env.NODO_FULL_VERIFY;delete process.env.NODO_FULL_VERIFY;
 try{
  const f=detailFixture(base),first=f.run(),second=f.run();f.compare(first,second);assert.equal(second.sales.reuse.years,2);assert.equal(second.rental.reuse.months,2);assert.deepEqual(second.rental.inputReuse,{partitions:2,parsed:0});
  const tx=JSON.parse(readFileSync(join(f.source,'data/tx/g.json')));tx.entries.entry[2026][0][5]='2026-10-03';f.put('data/tx/g.json',tx);
  const raw=f.rows['2026-09'].map(r=>({...r,name:'새 이름'}));f.put('data/contracts/apartment-rent/11110/202609.json',{rows:raw});
  const changed=f.run();assert.deepEqual(changed.sales.reuse,{years:1,builtYears:1});assert.deepEqual(changed.rental.reuse,{months:1,builtMonths:1});assert.deepEqual(changed.rental.inputReuse,{partitions:1,parsed:1});f.compare(changed,f.run(false));
  raw.pop();f.partitions[1].count=1;f.put('data/contracts/index.json',{schema:1,partitions:f.partitions});f.put('data/contracts/apartment-rent/11110/202609.json',{rows:raw});
  delete tx.entries.entry[2026];f.put('data/tx/g.json',tx);const removed=f.run();assert.equal(removed.sales.reuse.years,1);assert.equal(removed.rental.reuse.months,1);f.compare(removed,f.run(false));
  f.partitions.pop();f.put('data/contracts/index.json',{schema:1,partitions:f.partitions});
  const deletedMonth=f.run();assert.equal(deletedMonth.rental.reuse.months,1);assert.equal(existsSync(join(deletedMonth.out,'data/contracts/apartment-rent/11110/202609-details.bin')),false);f.compare(deletedMonth,f.run(false));
  process.env.NODO_FULL_VERIFY='1';const full=f.run();assert.equal(full.sales.reuse.years,0);assert.equal(full.rental.reuse.months,0);assert.equal(full.rental.inputReuse.parsed,1);f.compare(deletedMonth,full);
 }finally{if(old===undefined)delete process.env.NODO_FULL_VERIFY;else process.env.NODO_FULL_VERIFY=old;rmSync(base,{recursive:true});}
});
test('detail receipt exact key and identity prefix protect append, corruption and failed checks',()=>{
 const base=mkdtempSync(join(tmpdir(),'detail-proof-')),identity={11110:{complexes:['A'],areas:[[0,'59.001']],source:[['A',true]]}},path='data/sale-details/11110/2026.bin';
 try{
  let built=0;const run=(key=['code','input'],ids=identity)=>detailMemo(base,key,ids,p=>p===path,()=>{built++;return{result:{rows:1},files:new Map([[path,Buffer.from('x')]])};});
  assert.equal(run().reused,false);assert.equal(run().reused,true);
  const appended={11110:{complexes:['A','B'],areas:[[0,'59.001'],[1,'80.1']],source:[['A',true],['B',false]]}};assert.equal(run(undefined,appended).reused,true);
  assert.equal(run(['new code','input']).reused,false);assert.equal(run(['code','new input']).reused,false);assert.equal(built,3);
  const directory=join(base,'details',hash(JSON.stringify(['code','input'])));writeFileSync(join(directory,'0.bin'),'bad');assert.throws(()=>run(),/bytes changed/);
  assert.throws(()=>detailMemo(base,['fail'],identity,()=>true,()=>{throw Error('roundtrip failed');}),/roundtrip failed/);
  assert.equal(readdirSync(join(base,'details')).length,3);
 }finally{rmSync(base,{recursive:true});}
});

test('contract parsed inventory does not authorize outputs; counts, full mode and corruption remain checked',async()=>{
 const{contractInput}=await import('./housing-contract-input.mjs'),base=mkdtempSync(join(tmpdir(),'contract-input-')),p={count:2,path:'apartment-rent/11110/202609.json'},bytes=Buffer.from(JSON.stringify({rows:[{entityId:'A'},{entityId:'B'}]})),old=process.env.NODO_FULL_VERIFY;delete process.env.NODO_FULL_VERIFY;
 try{
  const first=contractInput(base,'engine',p,bytes);assert.equal(first.parsed,true);
  const reused=contractInput(base,'engine',p,bytes);assert.equal(reused.parsed,false);assert.deepEqual(reused.entities,['A','B']);assert.deepEqual(reused.rows(),first.rows());
  assert.throws(()=>contractInput(base,'engine',{...p,count:3},bytes),/count mismatch/);
  assert.equal(contractInput(base,'changed-engine',p,bytes).reused,false);
  process.env.NODO_FULL_VERIFY='1';assert.equal(contractInput(base,'engine',p,bytes).reused,false);delete process.env.NODO_FULL_VERIFY;
  const dir=join(base,'contract-inputs',hash(JSON.stringify(['engine',p,hash(bytes)]))),receipt=JSON.parse(readFileSync(join(dir,'receipt.json')));receipt.body.entities=['wrong'];writeFileSync(join(dir,'receipt.json'),JSON.stringify(receipt));assert.throws(()=>contractInput(base,'engine',p,bytes),/receipt mismatch/);
 }finally{if(old===undefined)delete process.env.NODO_FULL_VERIFY;else process.env.NODO_FULL_VERIFY=old;rmSync(base,{recursive:true});}
});

test('file batch consumption skips unchanged raw details, keeps corrections/deletions, and only accepted candidates advance',async()=>{
 const{GenerationFileSession}=await import('./housing-generation-batch.mjs');
 const base=mkdtempSync(join(tmpdir(),'detail-file-batch-')),old=process.env.NODO_FULL_VERIFY;delete process.env.NODO_FULL_VERIFY;
 try{
  const f=detailFixture(base);let n=0;
  function hashes(){for(const p of f.partitions)p.sourceHash=hash(readFileSync(join(f.source,'data/contracts/'+p.path)));f.put('data/contracts/index.json',{schema:1,partitions:f.partitions});
   f.put('data/map/index.json',{meta:{sources:{'data/tx/g.json':hash(readFileSync(join(f.source,'data/tx/g.json')))},sourceVersion:'initial'},d:[]});}
  hashes();const batch={schema:1,revision:'before',seq:0,batches:[]};
  function run(accept=false){const out=join(base,'batch'+n++);cpSync(f.seed,out,{recursive:true});const session=new GenerationFileSession({site:f.source,output:out,cache:f.cache,batch,engine:'fixture-1'}),sales=buildHousingSales(f.source,out,[],{cacheDir:f.cache,generationSession:session}),rental=buildHousingDetails(f.source,out,null,{cacheDir:f.cache,generationSession:session}),consumption=session.finish();
   if(accept)writeFileSync(join(f.cache,'generation-consumer.json'),readFileSync(consumption.pending));return{out,sales,rental,consumption};}
  const first=run();assert.equal(first.consumption.mode,'BASELINE');assert.equal(existsSync(join(f.cache,'generation-consumer.json')),false);
  const repeated=run(true);assert.equal(repeated.consumption.mode,'BASELINE');
  const reused=run();assert.equal(reused.consumption.rawInputsSkipped,3);assert.equal(reused.sales.reuse.batchRegions,1);assert.equal(reused.rental.inputReuse.parsed,0);f.compare(reused,f.run(false));
  const body={schema:1,previousRevision:'before',revision:'after',complete:true,tradePartitions:[],rentalPartitions:[{lawd:'11110',month:'202609'}]};
  batch.seq=1;batch.revision='after';const payload=JSON.stringify(body);batch.batches=[{seq:1,payload,digest:hash(payload)}];
  const raw=f.rows['2026-09'].map(r=>({...r,name:'new display'}));f.put('data/contracts/apartment-rent/11110/202609.json',{rows:raw});hashes();
  const display=run();assert.equal(display.rental.reuse.builtMonths,1);assert.equal(display.consumption.rawInputsSkipped,2);f.compare(display,f.run(false));
  // A failed/unaccepted candidate does not erase pending changes.
  const retry=run(true);assert.equal(retry.consumption.rawInputsSkipped,2);assert.equal(retry.consumption.batchesConsumed,1);
  const same=run();assert.equal(same.consumption.rawInputsSkipped,3);f.compare(retry,same);
  const tx=JSON.parse(readFileSync(join(f.source,'data/tx/g.json')));tx.entries.entry[2026][0][5]='2026-10-03';f.put('data/tx/g.json',tx);hashes();const cancelled=run(true);assert.equal(cancelled.sales.reuse.batchRegions,0);assert.equal(cancelled.sales.reuse.builtYears,1);f.compare(cancelled,f.run(false));
  delete tx.entries.entry[2026];f.put('data/tx/g.json',tx);f.partitions.pop();f.put('data/contracts/index.json',{schema:1,partitions:f.partitions});hashes();const removed=run(true);assert.equal(existsSync(join(removed.out,'data/contracts/apartment-rent/11110/202609-details.bin')),false);f.compare(removed,f.run(false));
  process.env.NODO_FULL_VERIFY='1';const full=run();assert.equal(full.consumption.mode,'BASELINE');f.compare(removed,full);
 }finally{if(old===undefined)delete process.env.NODO_FULL_VERIFY;else process.env.NODO_FULL_VERIFY=old;rmSync(base,{recursive:true});}
});
