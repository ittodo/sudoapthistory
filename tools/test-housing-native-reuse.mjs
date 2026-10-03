import{yearMemo}from'./housing-year-cache.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {buildHousingRegions} from './build-housing-regions.mjs';import * as codec from '../js/generated/housing-columns.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('native region packaging skips DTO reads only for identical current regional input',()=>{
 const base=mkdtempSync(join(tmpdir(),'native-reuse-')),root=join(base,'site'),cache=join(base,'cache'),calls=[],versions={11110:1,28185:1};mkdirSync(root);const sources={};
 try{
 const emit=(p,value)=>{const b=Buffer.from(JSON.stringify(value));mkdirSync(join(root,p,'..'),{recursive:true});writeFileSync(join(root,p),b);sources[p]=hash(b);};
 emit('data/map/index.json',{});emit('data/rental/rates.json',{});emit('data/rental/summary.json',{});
 const regions=new Map(['11110','28185'].map(code=>[code,{identity:{complexes:[code+'src'],areas:[[0,'59.1']]},metadata:{complexes:[{id:code+'src',n:'before',r:1}],areas:[]}}]));
 const readers={regionFingerprint:code=>'validated-files-'+versions[code],verify:()=>{}};
 for(const kind of ['daily','rental']){const manifest={schema:2,sources,regional:{bases:Object.fromEntries([...regions.keys()].map(c=>[c,{'2026-09':true}]))}};emit(`data/${kind}/index.json`,manifest);readers[kind]={manifest,table:{regions},inputs:{},regionMonth(code){calls.push(code+kind);const sale=[code+':0',20260901,100,2,0,null,null,null,null,0,'01'.repeat(10),null],rent=[code+':0','59.1',20260901,100,2,0,3,0,null,null,null,null,null,101,0,null,null,'02'.repeat(10)];return {rows:[kind==='daily'?sale:rent],updates:[],opening:[]};}};}
 const build=n=>buildHousingRegions(root,join(base,'out'+n),codec,{readers,cacheDir:cache});
 const first=build(1);assert.equal(calls.length,4);calls.length=0;regions.get('11110').metadata.complexes[0].n='after';
 const second=build(2);assert.equal(calls.length,0);assert.equal(second.metrics.filter(m=>m.regionReused).length,2);assert.deepEqual(readFileSync(join(base,'out1/data/daily/regions/11110/quarters/2026-Q3.bin')),readFileSync(join(base,'out2/data/daily/regions/11110/quarters/2026-Q3.bin')));
 assert.equal(JSON.parse(readFileSync(join(base,'out2/data/daily/regions/11110/metadata.json'))).complexes[0].n,'after');
 versions[28185]++;const third=build(3);assert.equal(calls.length,2);assert.equal(third.metrics.find(m=>m.code==='11110').regionReused,true);
 calls.length=0;const prior=process.env.NODO_FULL_VERIFY;try{process.env.NODO_FULL_VERIFY='1';build(4);assert.equal(calls.length,4);}finally{if(prior===undefined)delete process.env.NODO_FULL_VERIFY;else process.env.NODO_FULL_VERIFY=prior;}
 const firstRegion=readdirSync(join(cache,'native-regions')).map(name=>[name,JSON.parse(readFileSync(join(cache,'native-regions',name,'receipt.json')))]).find(([,r])=>r.body.code==='11110');
 const cachedFile=Object.values(firstRegion[1].body.files)[0].file;writeFileSync(join(cache,'native-regions',firstRegion[0],cachedFile),'damaged');assert.throws(()=>build(5),/cache bytes changed/);
 }finally{rmSync(base,{recursive:true,force:true});}
});

test('changed current year skips historical DTOs, appended IDs keep old bytes, full mode matches, damaged cache blocks',()=>{
 const base=mkdtempSync(join(tmpdir(),'native-years-')),root=join(base,'site'),cache=join(base,'cache');mkdirSync(root);
 const sources={},calls=[],versions={2025:1,2026:1},months=['2025-09','2026-09','2026-10'];
 const regions=new Map([['11110',{identity:{complexes:['old'],areas:[[0,'59.1']]},metadata:{complexes:[{id:'old',r:1}],areas:[]}}]]);
 const emit=(p,v)=>{const b=Buffer.from(JSON.stringify(v));mkdirSync(join(root,p,'..'),{recursive:true});writeFileSync(join(root,p),b);sources[p]=hash(b);};
 const readers={regionFingerprint:()=>JSON.stringify(versions),periodFingerprint:(code,ms)=>JSON.stringify(ms.map(m=>[m,versions[m.slice(0,4)]])),verify:()=>{}};
 const oldFull=process.env.NODO_FULL_VERIFY;delete process.env.NODO_FULL_VERIFY;
 try{
  emit('data/map/index.json',{});emit('data/rental/rates.json',{});emit('data/rental/summary.json',{});
  for(const kind of ['daily','rental']){
   const manifest={schema:2,sources,regional:{bases:{11110:Object.fromEntries(months.map(m=>[m,true]))}}};emit('data/'+kind+'/index.json',manifest);
   readers[kind]={manifest,table:{regions},inputs:{},regionMonth(code,month){
    calls.push(kind+month);const date=Number(month.replace('-','')+'01'),price=100+versions[month.slice(0,4)];
    const sale=[code+':0',date,price,2,0,null,null,null,null,0,'01'.repeat(10),null],rent=[code+':0','59.1',date,price,2,0,3,0,null,null,null,null,null,101,0,null,null,'02'.repeat(10)];
    return{rows:[kind==='daily'?sale:rent],updates:[],opening:kind==='daily'?[[code+':0',date,price,price,price,1]]:[rent]};
   }};
  }
  const build=n=>buildHousingRegions(root,join(base,'out'+n),codec,{readers,cacheDir:cache});
  build(1);assert.equal(calls.length,6);calls.length=0;
  versions[2026]++;const changed=build(2);assert.equal(calls.length,4);assert.equal(calls.some(p=>p.includes('2025')),false);
  assert.equal(changed.metrics[0].yearsReused,1);assert.equal(changed.metrics[0].monthsDecoded,2);
  const oldPath='data/daily/regions/11110/quarters/2025-Q3.bin';assert.deepEqual(readFileSync(join(base,'out1',oldPath)),readFileSync(join(base,'out2',oldPath)));
  calls.length=0;regions.get('11110').identity.complexes.push('new');regions.get('11110').identity.areas.push([1,'80.123']);
  const appended=build(3);assert.equal(calls.length,0);assert.equal(appended.metrics[0].yearsReused,2);
  process.env.NODO_FULL_VERIFY='1';const full=build(4);delete process.env.NODO_FULL_VERIFY;assert.equal(full.metrics[0].monthsDecoded,3);
  for(const kind of ['daily','rental'])assert.deepEqual(JSON.parse(readFileSync(join(base,'out3/data/'+kind+'/index.json'))),JSON.parse(readFileSync(join(base,'out4/data/'+kind+'/index.json'))));
  for(const kind of ['daily','rental'])delete readers[kind].manifest.regional.bases['11110']['2026-10'];
  versions[2026]++;calls.length=0;const removed=build(5);assert.equal(calls.length,2);assert.equal(removed.metrics[0].yearsReused,1);
  process.env.NODO_FULL_VERIFY='1';build(6);delete process.env.NODO_FULL_VERIFY;
  for(const kind of ['daily','rental'])assert.deepEqual(JSON.parse(readFileSync(join(base,'out5/data/'+kind+'/index.json'))),JSON.parse(readFileSync(join(base,'out6/data/'+kind+'/index.json'))));
  const entry=readdirSync(join(cache,'native-years')).map(n=>[n,JSON.parse(readFileSync(join(cache,'native-years',n,'receipt.json')))]).find(([,v])=>v.body.year==='2025');
  writeFileSync(join(cache,'native-years',entry[0],Object.values(entry[1].body.files)[0].file),'damaged');
  versions[2026]++;assert.throws(()=>build(7),/cache bytes changed/);
 }finally{if(oldFull===undefined)delete process.env.NODO_FULL_VERIFY;else process.env.NODO_FULL_VERIFY=oldFull;rmSync(base,{recursive:true});}
});

test('year cache preserves appended identity positions, rejects changed positions and receipt edits',()=>{
 const base=mkdtempSync(join(tmpdir(),'year-proof-')),identity={complexes:['a'],areas:[[0,'59.123']]};
 try{
  const memo=yearMemo(base,['engine1','input1'],'11110','2025'),path='data/daily/regions/11110/quarters/2025-Q1.bin';
  memo.save(identity,{'2025-01':path},{daily:{'2025-01':null},rental:{'2025-01':null}},{rows:1,bytes:1,files:1},[[path,Buffer.from('x')]]);
  const current={complexes:['a','new'],areas:[[0,'59.123'],[1,'80.9']]};assert.ok(memo.load(current,()=>{}));assert.equal(current.areas.length,2);
  assert.equal(memo.load({complexes:['different'],areas:[[0,'59.123']]},()=>{throw Error('unexpected emit');}),null);
  assert.equal(memo.load({complexes:['a'],areas:[[0,'59.124']]},()=>{throw Error('unexpected emit');}),null);
  const shorter={complexes:['a'],areas:[]};assert.ok(memo.load(shorter,()=>{}));assert.deepEqual(shorter.areas,identity.areas);
  assert.equal(yearMemo(base,['engine2','input1'],'11110','2025').load(current,()=>{}),null);
  const file=join(base,'native-years',readdirSync(join(base,'native-years'))[0],'receipt.json'),r=JSON.parse(readFileSync(file));r.body.metrics.rows++;writeFileSync(file,JSON.stringify(r));
  assert.throws(()=>memo.load(current,()=>{}),/receipt mismatch/);
 }finally{rmSync(base,{recursive:true});}
});

test('one corrected month reuses other quarters, preserves states and appended IDs; removals and damage are checked',()=>{
 const base=mkdtempSync(join(tmpdir(),'native-quarters-')),root=join(base,'site'),cache=join(base,'cache');mkdirSync(root);
 const sources={},calls=[],months=Array.from({length:12},(_,i)=>'2026-'+String(i+1).padStart(2,'0')),versions=Object.fromEntries(months.map(m=>[m,1]));
 const regions=new Map([['11110',{identity:{complexes:['old'],areas:[[0,'59.1']]},metadata:{complexes:[{id:'old',r:1}],areas:[]}}]]);
 const emit=(p,v)=>{const b=Buffer.from(JSON.stringify(v));mkdirSync(join(root,p,'..'),{recursive:true});writeFileSync(join(root,p),b);sources[p]=hash(b);};
 const readers={quarterFingerprint:(code,ms)=>JSON.stringify(ms.map(m=>[m,versions[m]])),verify:()=>{}};
 const prior=process.env.NODO_FULL_VERIFY;delete process.env.NODO_FULL_VERIFY;
 try {
  emit('data/map/index.json',{});emit('data/rental/rates.json',{});emit('data/rental/summary.json',{});
  for(const kind of ['daily','rental']){
   const manifest={schema:2,sources,regional:{bases:{11110:Object.fromEntries(months.map(m=>[m,true]))}}};emit('data/'+kind+'/index.json',manifest);
   readers[kind]={manifest,table:{regions},inputs:{},regionMonth(code,month){
    calls.push(kind+month);const date=Number(month.replace('-','')+'01'),price=100+versions[month];
    const sale=[code+':0',date,price,null,0,null,null,null,null,0,'01'.repeat(10),null],rent=[code+':0','59.1',date,price,2,1,null,0,null,null,null,null,null,101,0,null,null,'02'.repeat(10)];
    return {rows:[kind==='daily'?sale:rent],updates:[],opening:kind==='daily'?[[code+':0',date,price,price,price,1]]:[rent]};
   }};
  }
  const build=n=>buildHousingRegions(root,join(base,'out'+n),codec,{readers,cacheDir:cache});
  build(1);assert.equal(calls.length,24);calls.length=0;
  versions['2026-09']++;const changed=build(2);
  assert.equal(changed.metrics[0].quartersReused,3);assert.equal(changed.metrics[0].monthsDecoded,3);assert.equal(calls.length,6);
  for(const q of [1,2,4])assert.deepEqual(readFileSync(join(base,'out1/data/daily/regions/11110/quarters/2026-Q'+q+'.bin')),readFileSync(join(base,'out2/data/daily/regions/11110/quarters/2026-Q'+q+'.bin')));
  process.env.NODO_FULL_VERIFY='1';build(3);delete process.env.NODO_FULL_VERIFY;
  for(const kind of ['daily','rental'])assert.deepEqual(JSON.parse(readFileSync(join(base,'out2/data/'+kind+'/index.json'))),JSON.parse(readFileSync(join(base,'out3/data/'+kind+'/index.json'))));
  regions.get('11110').identity.complexes.push('new');regions.get('11110').identity.areas.push([1,'80.1234']);calls.length=0;
  assert.equal(build(4).metrics[0].quartersReused,4);assert.equal(calls.length,0);
  for(const kind of ['daily','rental'])delete readers[kind].manifest.regional.bases['11110']['2026-10'];
  calls.length=0;build(5);assert.equal(calls.length,4);
  process.env.NODO_FULL_VERIFY='1';build(6);delete process.env.NODO_FULL_VERIFY;
  for(const kind of ['daily','rental'])assert.deepEqual(JSON.parse(readFileSync(join(base,'out5/data/'+kind+'/index.json'))),JSON.parse(readFileSync(join(base,'out6/data/'+kind+'/index.json'))));
  const quarter=readdirSync(join(cache,'native-quarters')).map(n=>[n,JSON.parse(readFileSync(join(cache,'native-quarters',n,'receipt.json')))]).find(([,r])=>r.body.quarter==='2026-Q1');
  writeFileSync(join(cache,'native-quarters',quarter[0],'opening.bin'),'damaged');assert.throws(()=>build(7),/Quarter opening changed/);
 }finally{if(prior===undefined)delete process.env.NODO_FULL_VERIFY;else process.env.NODO_FULL_VERIFY=prior;rmSync(base,{recursive:true});}
});
