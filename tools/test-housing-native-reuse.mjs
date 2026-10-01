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
