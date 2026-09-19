const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {gzipSync}=require('node:zlib'),{createHash,webcrypto}=require('node:crypto');
const base=path.join(__dirname,'..'),files={},sources={};
function add(name,value){let bytes=Buffer.from(JSON.stringify(value));if(name.endsWith('.bin'))bytes=gzipSync(bytes);files[name]=bytes;sources[name]=createHash('sha256').update(bytes).digest('hex');}
const rows=Array.from({length:60},(_,i)=>[0,'84',20260917,10000,i+1,1,3,0,20250917,40,50,30,50,51+i,9,'2026-07',6,'r'+i]);
rows.push([0,'84',20260917,10000,99,2,3,1,null,null,null,null,null,null,0,'2026-07',6,'cancel']);
add('data/rental/catalog.bin',{complexes:[{id:'a',publicId:'a',r:1,g:'종로구',d:'창신동',n:'테스트',coord:[37.5,127]}]});
add('data/rental/rates.json',{rates:{11:{'2026-07':6}}});add('data/rental/summary.json',{});
for(const r of ['11','41','28']){add(`data/rental/months/2026-09-${r}.bin`,{rows:r==='11'?rows:[]});add(`data/rental/months/2026-09-${r}-state.bin`,{opening:[],updates:r==='11'?rows.filter(x=>!x[7]):[]});}
add('data/rental/history/2026/00.bin',{rows});
files['data/rental/index.json']=Buffer.from(JSON.stringify({schema:1,version:'v1',sources,months:['2026-09'],historyYears:['2026'],coverage:{11110:{'2026-09':{rows:61}}}}));
const pending=new Map();let sequence=0;
const context=vm.createContext({console,Response,Blob,TextDecoder,DecompressionStream,crypto:webcrypto,fetch:async url=>{const name=String(url).split('?')[0].replace(/^\//,'');return new Response(files[name],{status:files[name]?200:404});},postMessage:data=>{pending.get(data.id)(data);pending.delete(data.id);}});
context.self=context;context.importScripts=()=>vm.runInContext(fs.readFileSync(path.join(base,'js/rental-model.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(base,'js/rental-worker.js'),'utf8'),context);
function request(action,settings){const id=++sequence;return new Promise(resolve=>{pending.set(id,resolve);context.onmessage({data:{id,action,settings}});});}
(async()=>{
 assert.equal((await request('init')).meta.lastDate,'2026-09-17');
 const settings={type:'monthly',convert:true,day:'2026-09-17',period:'month',contract:'all',kind:'all',limit:50,sort:'value'};
 const r=await request('view',settings);assert.equal(r.error,undefined);assert.equal(r.stats.count,60);assert.equal(r.stats.cancelled,1);assert.equal(r.count,60);assert.equal(r.rows.length,50);assert.equal(r.histogram.reduce((n,b)=>n+b.count,0),60);
 const raw=await request('view',{...settings,convert:false});assert.equal(raw.stats.up,0);assert.equal(raw.rows[0].change,null);
 const cancel=await request('view',{...settings,kind:'cancelled'});assert.equal(cancel.count,1);
 const map=await request('view',{...settings,map:true});assert.equal(map.points.length,1);assert.equal(map.stats.cancelled,0);
 const detail=await request('view',{...settings,detail:'a',year:'2026'});assert.equal(detail.count,60);
 const none=await request('view',{...settings,detail:'missing',year:'2026'});assert.equal(none.count,0);
 const overlap=await Promise.all([request('view',settings),request('view',settings)]);assert.equal(overlap[0].stale,true);assert.equal(overlap[1].count,60);
 console.log('Rental worker integration tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
