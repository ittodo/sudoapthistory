import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync,realpathSync,statSync,existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {join,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {openRecords} from '../js/packed-records.mjs';
import {createApartmentRecordReader,restoreApartmentRecord,apartmentSummary} from '../js/apartment-records.mjs';
import {encodeApartmentShard,buildApartmentRecords,apartmentShardValues} from './build-apartment-records.mjs';
import {buildApartmentEntries} from './build-apartment-entries.mjs';
import {verifyApartmentEntries} from './verify-apartment-entries.mjs';
import {restoreApartmentEntry} from '../js/apartment-entry.mjs';
import * as cacheStore from './cache-store.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const metadata={updated:'2026-10-23',propertyUpdated:null};
const apartment={id:'one',name:'시험 단지',updated:metadata.updated,propertyUpdated:null,coord:[37.5,127.123456],pnus:['0012345678901234567'],rental:false,sources:['old-source'],areas:[{area:104,units:null,rows:[{i:0,source:'old-source',commentId:'apt_0',metrics:{cagr:1.25,land:null}}],latest:{date:20260925,price:100000.1,floor:null,flags:0,order:0},monthly:{202609:{average:100000.1,count:1}},yearly:{2026:{average:100000.1,count:1}},total:1}],review:{approved:false,sourceAliasConflicts:[]}};

test('apartment records retain exact values, absent fields and stamp overrides without rewriting common stamps',()=>{
 const values={one:apartment,override:{id:'override',updated:'2020-01-01',propertyUpdated:'2020-01-02',areas:[]},absent:{id:'absent',areas:[]}},bytes=encodeApartmentShard(values,metadata),view=openRecords(gunzipSync(bytes));
 for(const[id,value]of Object.entries(values))assert.deepEqual(restoreApartmentRecord(view.get(id),metadata),value);
 assert.equal(Object.hasOwn(view.get('one')[1],'updated'),false);
 const next={...metadata,updated:'2026-10-24'};
 assert.deepEqual(encodeApartmentShard({...values,one:{...apartment,updated:next.updated}},next),bytes);
 assert.equal(restoreApartmentRecord(view.get('one'),next).updated,next.updated);
 assert.equal(restoreApartmentRecord(view.get('override'),next).updated,'2020-01-01');
 assert.equal(Object.hasOwn(restoreApartmentRecord(view.get('absent'),next),'updated'),false);
 assert.equal(restoreApartmentRecord(view.get('missing'),next),undefined);
});

test('selected records share verified binary files, retry failures and evict files instead of caching decoded DTOs',async()=>{
 const bytes=encodeApartmentShard({one:apartment,two:{id:'two',areas:[]}},metadata),digest=hash(bytes),calls=[];
 let fail=true;const reader=createApartmentRecordReader(async path=>{calls.push(path);if(fail){fail=false;throw Error('temporary');}return bytes;},{maxFiles:1});
 const ref=id=>[id,'data/apartments/00.bin',digest];await assert.rejects(reader(ref('one'),metadata),/temporary/);
 const [one,two]=await Promise.all([reader(ref('one'),metadata),reader(ref('two'),metadata)]);assert.deepEqual(one,apartment);assert.equal(two.id,'two');assert.equal(calls.length,2);
 one.areas[0].rows[0].commentId='mutated';assert.equal((await reader(ref('one'),metadata)).areas[0].rows[0].commentId,'apt_0');assert.equal(calls.length,2);
 await reader(['one','data/apartments/01.bin',digest],metadata);await reader(ref('one'),metadata);assert.equal(calls.length,4);
 await assert.rejects(reader(['one','data/apartments/02.bin','0'.repeat(64)],metadata),/source changed/);
 assert.equal(await reader(ref('missing'),metadata),undefined);
});

test('browser summaries read one verified entry and selected BIN without the national catalog',async t=>{
 const bytes=encodeApartmentShard({one:apartment},metadata),entry=Buffer.from(JSON.stringify({schema:3,lookup:{one:['one','00']},legacy:{},routes:{one:null}}));
 const index={schema:3,metadata:{version:2,format:'packed-records-v1',...metadata,sources:{}},basis:{sale:'fixture',rental:'fixture'},shards:{'data/apartments/00.bin':hash(bytes),'data/apartments/summary/00.bin':hash(bytes)},sources:Object.fromEntries(Array.from({length:64},(_,n)=>['data/apartments/entry/'+n.toString(16).padStart(2,'0')+'.json',hash(entry)]))};
 const calls=[],original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});globalThis.fetch=async url=>{const path=new URL(url,'https://fixture.test').pathname;calls.push(path);if(path==='/data/apartments/entry-index.json')return Response.json(index);if(path.startsWith('/data/apartments/entry/'))return new Response(entry);if(path==='/data/apartments/summary/00.bin')return new Response(bytes);throw Error('Unexpected data read: '+path);};
 assert.deepEqual(await apartmentSummary('one'),apartment);assert.deepEqual(await apartmentSummary('one'),apartment);assert.equal(calls.length,3);assert.equal(await apartmentSummary('missing'),null);assert.ok(!calls.includes('/data/apartments/index.json'));
});

test('isolated packing and entries retain aliases, legacy area zero IDs, hashes and rental catalog binding',()=>{
 const temp=mkdtempSync(join(tmpdir(),'apartment-records-')),source=join(temp,'source'),output=join(temp,'output');
 const put=(root,path,value)=>{const bytes=Buffer.from(JSON.stringify(value));mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);return hash(bytes);};
 try{
  const index={version:2,...metadata,count:1,lookup:{one:['one','00'],alias:['one','00'],'old-source':['one','00']},legacy:{0:['one',104]},sources:{},shards:{},ambiguous:[]};
  for(let n=0;n<256;n++)for(const prefix of ['','summary/']){const path='data/apartments/'+prefix+n.toString(16).padStart(2,'0')+'.json';index.shards[path]=put(source,path,n===0?{one:apartment}:{});}
  const before=put(source,'data/apartments/index.json',index);
  put(source,'data/apartment-rent/index.json',{schema:2,catalogHash:before});put(source,'data/sale-details/index.json',{format:'sale-fact-references'});put(source,'data/daily/regions/index.json',{regions:{11110:{identities:'data/daily/regions/11110/identities.json'}}});put(source,'data/daily/regions/11110/identities.json',{complexes:['old-source'],areas:[]});
  const first=buildApartmentRecords(source,output);assert.equal(first.encoded,512);mkdirSync(join(output,'data/sale-details'),{recursive:true});copyFileSync(join(source,'data/sale-details/index.json'),join(output,'data/sale-details/index.json'));
  const next=JSON.parse(readFileSync(join(output,'data/apartments/index.json'))),path='data/apartments/00.bin';
  assert.equal(next.version,2);assert.equal(next.format,'packed-records-v1');assert.equal(Object.keys(next.shards).length,512);assert.ok(Object.keys(next.shards).every(p=>p.endsWith('.bin')));
  assert.deepEqual(apartmentShardValues(readFileSync(join(output,path)),path,next),{one:apartment});assert.deepEqual(next.lookup,index.lookup);assert.deepEqual(next.legacy,index.legacy);
  assert.equal(hash(readFileSync(join(source,'data/apartments/index.json'))),before);
  assert.equal(JSON.parse(readFileSync(join(output,'data/apartment-rent/index.json'))).catalogHash,hash(readFileSync(join(output,'data/apartments/index.json'))));
  const stamp=statSync(join(output,path)).mtimeMs,warm=buildApartmentRecords(source,output);assert.equal(warm.reused,512);assert.equal(warm.encoded,0);assert.equal(warm.written,0);assert.equal(statSync(join(output,path)).mtimeMs,stamp);
  next.updated='2026-10-24';put(output,'data/apartments/index.json',next);const changed=buildApartmentRecords(output,output);assert.equal(changed.reused,512);assert.equal(changed.encoded,0);assert.equal(statSync(join(output,path)).mtimeMs,stamp);assert.equal(apartmentShardValues(readFileSync(join(output,path)),path,next).one.updated,next.updated);
  buildApartmentEntries(output,{fallback:source});assert.equal(verifyApartmentEntries(output).status,'PASS');
  const directory=JSON.parse(readFileSync(join(output,'data/apartments/entry-index.json'))),entry=key=>restoreApartmentEntry(JSON.parse(readFileSync(join(output,'data/apartments/entry/'+(parseInt(hash(key).slice(0,2),16)&63).toString(16).padStart(2,'0')+'.json'))),directory);
  assert.deepEqual(entry('alias').lookup.alias,['one',path,next.shards[path]]);assert.deepEqual(entry('alias').summaries.alias,['one','data/apartments/summary/00.bin',next.shards['data/apartments/summary/00.bin']]);assert.deepEqual(entry('row:0').legacy[0],['one',path,next.shards[path],104]);
  const stamps=new Map(Object.keys(next.shards).map(p=>[p,statSync(join(output,p),{bigint:true}).mtimeNs]));
  const revised={...apartment,name:'수정된 시험 단지'};index.shards['data/apartments/00.json']=put(source,'data/apartments/00.json',{one:revised});put(source,'data/apartments/index.json',index);
  const partial=buildApartmentRecords(source,output),updated=JSON.parse(readFileSync(join(output,'data/apartments/index.json')));assert.equal(partial.encoded,1);assert.equal(partial.reused,511);
  assert.deepEqual(apartmentShardValues(readFileSync(join(output,path)),path,updated),{one:revised});assert.notEqual(updated.shards[path],next.shards[path]);
  for(const[p,mtime]of stamps)if(p!==path){assert.equal(updated.shards[p],next.shards[p],p+' must retain its bytes');assert.equal(statSync(join(output,p),{bigint:true}).mtimeNs,mtime,p+' must not be rewritten');}
 }finally{const resolved=realpathSync(temp),base=realpathSync(tmpdir());if(!resolved.startsWith(base+sep)||!resolved.slice(base.length+1).startsWith('apartment-records-'))throw Error('Unsafe test cleanup');rmSync(resolved,{recursive:true});}
});

test('native packing uses the shared virtual cache without a nested database and reuses unchanged outputs',()=>{
 const root=mkdtempSync(join(tmpdir(),'apartment-record-cache-')),source=join(root,'source'),output=join(root,'output'),native=join(root,'native'),cacheDir=join(native,'_ops','regional-transaction-cache','baseline','packed');
 const put=(path,value)=>{const bytes=Buffer.from(JSON.stringify(value));mkdirSync(dirname(join(source,path)),{recursive:true});writeFileSync(join(source,path),bytes);return hash(bytes);};
 try{
  const index={version:2,...metadata,count:1,lookup:{one:['one','00']},legacy:{},sources:{},shards:{},ambiguous:[]};
  for(let n=0;n<256;n++)for(const prefix of ['','summary/']){const path='data/apartments/'+prefix+n.toString(16).padStart(2,'0')+'.json';index.shards[path]=put(path,n===0?{one:apartment}:{});}const before=put('data/apartments/index.json',index);
  const originalDb=join(source,'transactions.sqlite'),sourceDb=new DatabaseSync(originalDb);sourceDb.exec('CREATE TABLE transactions(id INTEGER PRIMARY KEY,price REAL); INSERT INTO transactions VALUES(1,100000.1)');sourceDb.close();const sourceHash=hash(readFileSync(originalDb));
  const sibling=join(cacheDir,'details','existing.bin');cacheStore.mkdirSync(dirname(sibling),{recursive:true});cacheStore.writeFileSync(sibling,Buffer.from('other native builder'));
  const first=buildApartmentRecords(source,output,{cacheDir});assert.equal(first.encoded,512);
  assert.equal(existsSync(cacheDir),false,'The native cache directory is a virtual store key');assert.equal(existsSync(join(cacheDir,'housing-cache.sqlite')),false,'No nested database may be created');assert.equal(existsSync(join(output,'cloudflare/dist/housing-cache.sqlite')),false);
  const database=join(native,'data/housing-cache.sqlite');assert.equal(existsSync(database),true);const shared=new DatabaseSync(database,{readOnly:true});
  try{assert.equal(shared.prepare("SELECT count(*) n FROM cache_artifact WHERE scope='regional-transaction-cache' AND key LIKE 'baseline/packed/apartment-records-v1/%' AND kind=0").get().n,1024);}finally{shared.close();}
  const path=join(output,'data/apartments/00.bin'),stamp=statSync(path).mtimeMs,warm=buildApartmentRecords(source,output,{cacheDir});assert.equal(warm.reused,512);assert.equal(warm.encoded,0);assert.equal(warm.written,0);assert.equal(statSync(path).mtimeMs,stamp);
  assert.equal(cacheStore.readFileSync(sibling,'utf8'),'other native builder');assert.equal(hash(readFileSync(originalDb)),sourceHash);assert.equal(hash(readFileSync(join(source,'data/apartments/index.json'))),before);
 }finally{cacheStore.closeCacheStores();const resolved=realpathSync(root),base=realpathSync(tmpdir());if(!resolved.startsWith(base+sep)||!resolved.slice(base.length+1).startsWith('apartment-record-cache-'))throw Error('Unsafe test cleanup');rmSync(resolved,{recursive:true});}
});
