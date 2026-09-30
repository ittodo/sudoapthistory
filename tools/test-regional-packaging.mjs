import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,statSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {regionalReader,verifyRegionalData} from './regional-data.mjs';
import {rentalMapAssets} from './build-rental-map-cache.mjs';
import {rentalMarketAssets} from './build-rental-market-cache.mjs';
import {regionPriceAssets} from './build-region-price-cache.mjs';
const repo=join(import.meta.dirname,'..'),sha='6b228d2b3da03eb7d04a1d9ab2845f54bf6a32ec';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('fixed-region packaging has independent source numbers, no legacy files, and content-scoped reuse',()=>{
 const root=mkdtempSync(join(tmpdir(),'fixed-region-')),sources={},write=(p,b)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),b);},add=(p,v)=>{let b=Buffer.from(JSON.stringify(v));if(p.endsWith('.bin'))b=gzipSync(b);write(p,b);sources[p]=hash(b);};
 try{
  for(const p of ['js/map-model.js','js/daily-model.js','js/rental-model.js','js/rental-map-model.js','tools/build-region-price-cache.mjs'])write(p,readFileSync(join(repo,p)));
  const descriptor={schema:2,baselineCommit:sha,regions:{}},bases={},baseHashes={};
  for(const [code,r]of [['11110',1],['41610',0]]){
   const dir=`data/daily/regions/${code}`,identity=`${dir}/identities.json`,meta=`${dir}/metadata.json`,path=`${dir}/base/2026-Q3.bin`,ci=code+':0';
   add(identity,{complexes:[code+'-1'],areas:[[0,'59.0001']]});add(meta,{complexes:[{id:code+'-1',r,g:r?'종로구':'광주시',d:'동',n:'단지',coord:[37,127],admin:[code.slice(0,2),code,'dong'],publicId:code+'-1'}]});descriptor.regions[code]={identities:identity,metadata:meta};
   const row=[ci,'59.0001',20260902,10000,50,1,5,0,null,null,null,null,null,100,0,'2026-07',6,'content-'+ci];
   add(path,{schema:1,baselineCommit:sha,lawd:code,quarter:'2026-Q3',months:{'2026-09':{schema:1,baselineCommit:sha,lawd:code,month:'2026-09',daily:{rows:[[ci,20260902,10000,5,0,null,null,null,null,0,'sale-'+ci,null]],opening:[],updates:[[ci,20260902,10000,10000,10000,1]]},rental:{rows:[row],opening:[],updates:[row]}}}});bases[code]={'2026-09':path};baseHashes[path]=sources[path];
  }
  add('data/daily/regions/index.json',descriptor);add('data/daily/regions/baseline.json',{schema:2,baselineCommit:sha,bases,sources:baseHashes});add('data/rental/rates.json',{rates:{11:{'2026-07':6},41:{'2026-07':6}}});
  add('data/map/index.json',{meta:{sourceVersion:'map1'},d:[{id:'11110-1',r:1,admin:['11','11110','dong']},{id:'41610-1',r:0,admin:['41','41610','dong']}]});
  const save=()=>{for(const kind of ['daily','rental'])write(`data/${kind}/index.json`,JSON.stringify({schema:2,version:'fixed1',months:['2026-09'],sources,regional:{format:'fixed-region',kind,authority:'data/daily/regions/index.json',baselineManifest:'data/daily/regions/baseline.json',baselineCommit:sha,bases,overlays:{}}}));};save();
  assert.equal(verifyRegionalData(root,'daily').legacyCompatibility,false);assert.equal(verifyRegionalData(root,'rental').regions,2);
  const reader=regionalReader(root,'rental');assert.equal(reader.read('data/rental/months/2026-09-11.bin').rows[0][0],'11110:0');assert.equal(reader.read('data/rental/months/2026-09-41.bin').rows[0][0],'41610:0');
  const first=rentalMapAssets(root),market=rentalMarketAssets(root),prices=regionPriceAssets(root);assert.equal(JSON.parse(gunzipSync(readFileSync(first.find(a=>a.path.endsWith('2026-09-11-monthly.bin')).source))).updates[0][0],'11110:0');assert.equal(JSON.parse(gunzipSync(readFileSync(market.find(a=>a.path.endsWith('2026-09-41.bin')).source))).rows[0][0],'41610:0');assert.equal(prices.filter(a=>a.source).length,18);
  const target=first.find(a=>a.path.endsWith('2026-09-11-monthly.bin')).source,mtime=statSync(target).mtimeMs,fingerprint=reader.fingerprint('data/rental/months/2026-09-11-state.bin');
  add('data/daily/regions/11110/metadata.json',{complexes:[{id:'11110-1',r:1,g:'종로구',n:'새 이름',coord:[38,128],tu:6}]});save();assert.equal(regionalReader(root,'rental').fingerprint('data/rental/months/2026-09-11-state.bin'),fingerprint);rentalMapAssets(root);assert.equal(statSync(target).mtimeMs,mtime);assert.deepEqual(rentalMarketAssets(root).filter(a=>a.source),market.filter(a=>a.source));
  write(bases['11110']['2026-09'],'corrupt');assert.throws(()=>verifyRegionalData(root,'rental'),/source mismatch/);
 }finally{assert.ok(root.startsWith(join(tmpdir(),'fixed-region-')));rmSync(root,{recursive:true,force:true});}
});