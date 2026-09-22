import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {latestRent,homeSearchAssets} from './build-home-search-data.mjs';
import {searchData} from './build-search-data.mjs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const ctx=vm.createContext({});vm.runInContext(readFileSync(new URL('../js/home-search-model.js',import.meta.url),'utf8'),ctx);const M=ctx.NodoHomeSearchModel;
const entity=(id,rows=[],rentalIds=[])=>({id,name:id,r:0,g:'수지구',d:'풍덕천동',rows,rentalIds,saleIds:[],addresses:[]});
test('legacy investment sort in a rental URL cannot sort rental results by sale metrics',()=>{
 for(const type of ['jeonse','monthly'])for(const key of ['c','m','s','ret','v'])assert.equal(M.sortKey(type,key),'ld');
 assert.equal(M.sortKey('sale','c'),'c');assert.equal(M.sortKey('monthly','lp'),'lp');assert.equal(M.sortKey('jeonse','ls'),'ls');
});
test('shared roster keeps IDs and sale metrics, adds rental-only areas and leaves missing prices null',()=>{
 const sale=[{i:7,as:'s',n:'a',a:59,r:0,g:'수지구',lp:4,c:5,si:[7]}],catalog=[entity('public',[7],['r']),entity('rental:r2',[],['r2']),entity('meta')];
 const prices=[{id:'public',area:59,type:'jeonse',deposit:30000,date:'2026-09-01',transactionId:'1'},{id:'public',area:84,type:'monthly',rent:50,date:'2026-08-01',transactionId:'2'},{id:'rental:r2',area:49,type:'monthly',rent:20,date:'2026-09-02',transactionId:'3'}];
 const rows=M.join(sale,catalog,prices);assert.equal(rows.length,4);assert.equal(rows[0].i,7);assert.equal(rows[0].lp,4);assert.equal(rows[0].c,5);assert.deepEqual(sale[0].si,[7]);
 const lookup=Object.fromEntries(rows.map(r=>[r.i,r]));for(const type of ['sale','jeonse','monthly'])assert.equal(rows.length,4);
 assert.equal(M.record(rows[0],'monthly',lookup),null);assert.equal(M.record({_merged:true,si:rows[0].si},'monthly',lookup).rent,50);
 assert.equal(M.fallback(catalog[1]).rental,false);assert.equal(M.fallback(catalog[1]).id,'r2');assert.equal(rows.find(r=>r._homeId==='rental:r2').lp,null);
});

test('latest search download is shared across concurrent tab switches and rejects corrupt inputs',async()=>{
 let fetches=0,downloads=0,broken=false;
 const digest='a'.repeat(64),sources=Object.fromEntries(['41','11','28'].map(r=>['data/search/latest-'+r+'.bin',digest]));
 const context=vm.createContext({Response,Blob,DecompressionStream,fetch:async()=>{fetches++;return {ok:true,json:async()=>({schema:1,inputs:{'data/index.json':digest},sources})};},NodoVerifiedDataCache:{create:()=>({download:async(path,expected)=>{downloads++;assert.equal(expected,digest);if(broken)throw Error('checksum mismatch');return gzipSync(JSON.stringify({schema:1,apartments:[{id:path}],prices:[]}));}})}});
 vm.runInContext(readFileSync(new URL('../js/home-search-data.js',import.meta.url),'utf8'),context);
 const results=await Promise.all(Array.from({length:20},()=>context.NodoHomeSearchData.load()));
 assert.ok(results.every(r=>r===results[0]));assert.equal(fetches,1);assert.equal(downloads,3);
 await context.NodoHomeSearchData.load();assert.equal(downloads,3);
 broken=true;vm.runInContext(readFileSync(new URL('../js/home-search-data.js',import.meta.url),'utf8'),context);
 await assert.rejects(context.NodoHomeSearchData.load(),/checksum mismatch/);
 broken=false;assert.equal((await context.NodoHomeSearchData.load()).apartments.length,3);
 sources['data/search/latest-41.bin']='invalid';vm.runInContext(readFileSync(new URL('../js/home-search-data.js',import.meta.url),'utf8'),context);
 await assert.rejects(context.NodoHomeSearchData.load(),/버전/);
});

test('unlinked homonyms stay separate and only approved rental classification is displayed',()=>{
 const a={...entity('rental:a',[],['a']),name:'같은 이름',units:200,built:2020},b={...entity('rental:b',[],['b']),name:'같은 이름',rental:true};
 const rows=M.join([], [a,b], []);assert.equal(rows.length,2);assert.notEqual(rows[0].i,rows[1].i);assert.equal(rows[0].tu,200);assert.equal(rows[0].b,2020);
 assert.equal(M.fallback(a).rental,false);assert.equal(M.fallback(b).rental,true);
});

test('published inputs retain every sale row and every catalog identity in the common roster',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),search=JSON.parse(searchData(root)),assets=homeSearchAssets(root,search);
 const parts=assets.filter(a=>a.path.endsWith('.bin')).map(a=>JSON.parse(gunzipSync(a.bytes))),prices=parts.flatMap(p=>p.prices),apartments=parts.flatMap(p=>p.apartments);
 const original=JSON.parse(readFileSync(new URL('../data/index.json',import.meta.url))).d,roster=M.join(original,apartments,prices),byRow=new Map(roster.map(r=>[r.i,r])),ids=new Set(roster.map(r=>r._homeId));
 for(const row of original){const actual=byRow.get(row.i);for(const key of Object.keys(row))if(key!=='si')assert.deepEqual(actual[key],row[key]);}
 for(const e of apartments)assert.ok(ids.has(e.id),e.id);
 const keys=new Set(roster.map(r=>JSON.stringify([r._homeId,Math.round(r.a)])));for(const t of prices)assert.ok(keys.has(JSON.stringify([t.id,t.area])));
 assert.equal(new Set(roster.map(r=>r.i)).size,roster.length);
 assert.ok(roster.some(r=>r._synthetic&&r.lp===null&&r._rents.monthly));
});
test('latest rental snapshot uses source state, exact areas, cancellation and stable ties without needing coordinates',()=>{
 const catalog=[{id:'r'},{id:'other'}],ids=new Map([['r',entity('public',[],['r'])],['other',entity('rental:other',[],['other'])]]);
 const row=(area,date,deposit,rent,id,cancelled=0,contract=1,ci=0)=>[ci,String(area),date,deposit,rent,contract,3,cancelled,null,null,null,null,null,rent?100:null,1,'2026-09',rent?4:null,id];
 const shard={opening:[row(59.1,20260801,10000,0,'old'),row(84,20260801,20000,0,'cancelled-key')],updates:[row(59.1,20260901,20000,0,'a'),row(59.4,20260901,30000,0,'z'),row(59.2,20260902,5000,50,'monthly'),row(84,20260903,20000,0,'cancel',1),row(49,20260901,1000,20,'unmatched',0,1,1)]};
 const result=latestRent(shard,catalog,ids);assert.equal(result.length,3);const jeonse=result.find(r=>r.type==='jeonse');assert.equal(jeonse.deposit,30000);assert.equal(jeonse.exactArea,59.4);assert.equal(jeonse.sourceId,'r');assert.equal(result.find(r=>r.type==='monthly'&&r.id==='public').equivalent,20000);assert.ok(result.some(r=>r.id==='rental:other'));
 const missing=latestRent({opening:[row(59,20260901,5000,50,'missing')].map(r=>{r[13]=null;r[16]=null;return r;}),updates:[]},catalog,ids)[0];assert.equal(missing.value,null);assert.equal(missing.equivalent,null);assert.equal(missing.rent,50);
});
