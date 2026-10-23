import{test}from'node:test';import assert from'node:assert/strict';import{gunzipSync}from'node:zlib';import{createHash}from'node:crypto';import{partitionHousing}from'./housing-partition.mjs';import{joinPartition,partitionDescriptor,validateRanges}from'../js/housing-partition.mjs';import*as codec from'../js/generated/housing-columns.mjs';
import'../js/regional-data.js';import{create}from'../js/housing-regional.mjs';
const identity={complexes:['A'],areas:Array.from({length:600},(_,i)=>[0,String(20+i/1000)])},rows=identity.areas.map((a,i)=>['11110:'+i,20260901,10000+i,2,0,null,null,null,null,1,createHash('sha256').update(String(i)).digest('hex'),null]),months={'2026-09':{daily:{rows,updates:[]},rental:{rows:[],updates:[]}}};
function build(limit,previous=null,input=months,kind='quarter'){const files={},sources={};const result=partitionHousing({code:'11110',scope:kind==='quarter'?'2026-Q3':'2026',kind,months:input,identity,codec,path:kind==='quarter'?'data/daily/regions/11110/quarters/2026-Q3.bin':`data/daily/regions/11110/states/${kind}/2026.bin`,limit,previous,emit:(p,b)=>{files[p]=b;sources[p]=createHash('sha256').update(b).digest('hex');}});return {...result,files,sources};}
function open(p){partitionDescriptor(p.descriptor,p.path,p.sources);return joinPartition(p.descriptor,p.descriptor.leaves.map(x=>new Uint8Array(gunzipSync(p.files[x.path]))),new Uint8Array(gunzipSync(p.files[p.descriptor.order])),identity,codec);}
test('oversize quarters split by permanent exact-area ranges with exact row order',()=>{const p=build(12000);assert.ok(p.descriptor.leaves.length>1);assert.ok(Object.values(p.files).every(b=>b.length<=12000));assert.deepEqual(open(p).month('2026-09'),months['2026-09']);const b=build(20000,p.descriptor);assert.deepEqual(b.descriptor.leaves,p.descriptor.leaves);assert.deepEqual(open(b).month('2026-09'),months['2026-09']);const c=build(12000);assert.deepEqual(c.files,p.files);});
test('partition boundaries never merge after most rows disappear',()=>{const a=build(12000),small={'2026-09':{daily:{rows:[rows[599]],updates:[]},rental:{rows:[],updates:[]}}},b=build(12000,a.descriptor,small);assert.deepEqual(b.descriptor.leaves,a.descriptor.leaves);assert.deepEqual(open(b).month('2026-09'),small['2026-09']);});
test('partition validation rejects bad coverage, wrong paths, missing order and wrong member',()=>{assert.throws(()=>validateRanges(['0']));assert.throws(()=>validateRanges(['0','01','1']));const p=build(12000),bad=structuredClone(p.descriptor);bad.leaves[0].path='data/other.bin';assert.throws(()=>partitionDescriptor(bad,p.path,p.sources));const order=gunzipSync(p.files[p.descriptor.order]);assert.throws(()=>joinPartition(p.descriptor,p.descriptor.leaves.map(x=>gunzipSync(p.files[x.path])),order.subarray(0,order.length-1),identity,codec));});
test('state partitions preserve empty months and ordering',()=>{const opening=rows.map((r,i)=>[r[0],20260901,12345+i,22345+i,15345+i,1]),m={'2026-08':[],'2026-09':opening};const p=build(2200,null,m,'daily');assert.ok(p.descriptor);assert.deepEqual(open(p).month('2026-08'),[]);assert.deepEqual(open(p).month('2026-09'),opening);});

test('browser map shards preserve partitioned sale and rental updates and opening order',async()=>{
 const month='2026-09',rental=rows.map((r,i)=>['11110:0',identity.areas[i][1],20260901,10000+i,50,1,2,0,null,null,null,null,null,100,0,null,null,r[10]]);
 const updates=rows.map(r=>[r[0],r[1],r[2],r[2],r[2],1]);
 const input={[month]:{daily:{rows,updates},rental:{rows:rental,updates:rental}}},quarter=build(12000,null,input);
 assert.ok(quarter.descriptor,'fixture uses partitioned quarters');
 for(const kind of ['daily','rental']){
  const opening=(kind==='daily'?updates:rental).slice().reverse(),state=build(9000,null,{[month]:opening},kind),prefix='data/daily/regions/11110';
  const files={...quarter.files,...state.files},sources={...quarter.sources,...state.sources};
  const emit=(path,value)=>{files[path]=Buffer.from(JSON.stringify(value));sources[path]=createHash('sha256').update(files[path]).digest('hex');};
  const regions={'11110':{identities:prefix+'/identities.json',metadata:prefix+'/metadata.json'}};
  emit(regions['11110'].identities,identity);emit(regions['11110'].metadata,{complexes:[{id:'A',n:'단지',r:1}],areas:[]});emit('data/daily/regions/index.json',{schema:3,regions});
  const manifest={schema:3,months:[month],sources,regional:{format:'packed-region',kind,authority:'data/daily/regions/index.json',quarters:{'11110':{[month]:quarter.path}},states:{'11110':{[month]:state.path}}}};
  const browser=await create(manifest,kind,async path=>path.endsWith('.bin')?new Uint8Array(gunzipSync(files[path])):JSON.parse(files[path]));
  assert.deepEqual(await browser.shard('map-state.bin',month,1),{rows:[],opening,updates:input[month][kind].updates});
  assert.deepEqual(await browser.regionMonth('11110',month),{...input[month][kind],opening},'full transaction API stays intact after map projection');
 }
});

test('cancelled partition leaves and order files are immediately retryable with resident descriptors',async()=>{
 const month='2026-09',updates=rows.map(r=>[r[0],r[1],r[2],r[2],r[2],1]),opening=updates.slice().reverse();
 const quarter=build(12000,null,{[month]:{daily:{rows,updates},rental:{rows:[],updates:[]}}}),state=build(2200,null,{[month]:opening},'daily');
 assert.ok(quarter.descriptor&&state.descriptor);
 const files={...quarter.files,...state.files},sources={...quarter.sources,...state.sources},prefix='data/daily/regions/11110';
 const emit=(path,value)=>{files[path]=Buffer.from(JSON.stringify(value));sources[path]=createHash('sha256').update(files[path]).digest('hex');};
 const regions={'11110':{identities:prefix+'/identities.json',metadata:prefix+'/metadata.json'}};
 emit(regions['11110'].identities,identity);emit(regions['11110'].metadata,{complexes:[{id:'A',n:'단지',r:1}],areas:[]});emit('data/daily/regions/index.json',{schema:3,regions});
 const manifest={schema:3,months:[month],sources,regional:{format:'packed-region',kind:'daily',authority:'data/daily/regions/index.json',quarters:{'11110':{[month]:quarter.path}},states:{'11110':{[month]:state.path}}}};
 for(const target of [quarter.descriptor.leaves[0].path,quarter.descriptor.order,state.descriptor.leaves[0].path,state.descriptor.order]){
  const resident=new Map();let started,reject,blocked=true;const ready=new Promise(resolve=>started=resolve);
  const browser=await create(manifest,'daily',async path=>{
   if(path===target&&blocked){blocked=false;return new Promise((resolve,fail)=>{reject=fail;started();});}
   if(!resident.has(path))resident.set(path,path.endsWith('.bin')?new Uint8Array(gunzipSync(files[path])):JSON.parse(files[path]));
   return resident.get(path);
  });
  const old=browser.shard('map-state.bin',month,1);await ready;
  const rejected=assert.rejects(old,/cancelled partition member/);
  reject(Error('cancelled partition member'));browser.discardPending([target]);
  const current=await browser.shard('map-state.bin',month,1);await rejected;
  assert.deepEqual(current,{rows:[],opening,updates},target);
  browser.discardPending([target]);
  assert.equal(await browser.shard('map-state.bin',month,1),current,'completed shard remains reusable');
 }
});
