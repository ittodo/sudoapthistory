import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {join,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {buildApartmentEntries} from './build-apartment-entries.mjs';
import {verifyApartmentEntries} from './verify-apartment-entries.mjs';
import {restoreApartmentEntry,createApartmentEntryReader} from '../js/apartment-entry.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('direct entries use actual region identity, preserve aliases/legacy links and detect stale owners',()=>{
 const root=mkdtempSync(join(tmpdir(),'common-entry-')),put=(p,v)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),JSON.stringify(v));};
 try{const source='99999-source',catalog={version:2,updated:'fixture',lookup:{public:['public','00'],[source]:['public','00'],empty:['empty','01']},legacy:{7:['public',59]},sources:{},shards:{'data/apartments/00.json':'a'.repeat(64),'data/apartments/01.json':'b'.repeat(64)}};
  put('data/apartments/index.json',catalog);put('data/sale-details/index.json',{format:'sale-fact-references'});put('data/apartment-rent/index.json',{schema:2});put('data/daily/regions/index.json',{regions:{11110:{identities:'data/daily/regions/11110/identities.json'}}});put('data/daily/regions/11110/identities.json',{complexes:[source],areas:[]});
  const built=buildApartmentEntries(root);assert.equal(built.written,64);assert.equal(buildApartmentEntries(root).written,0);verifyApartmentEntries(root);
  const index=()=>JSON.parse(readFileSync(join(root,'data/apartments/entry-index.json'))),entry=id=>restoreApartmentEntry(JSON.parse(readFileSync(join(root,'data/apartments/entry/'+(parseInt(hash(id).slice(0,2),16)&63).toString(16).padStart(2,'0')+'.json'))),index());
  assert.deepEqual(entry(source).routes[source],{region:'11110',local:0});assert.equal(entry('empty').routes.empty,null);assert.deepEqual(entry('row:7').legacy[7],['public','data/apartments/00.json','a'.repeat(64),59]);
  catalog.updated='changed';put('data/apartments/index.json',catalog);assert.throws(()=>verifyApartmentEntries(root),/basis/);
  assert.equal(buildApartmentEntries(root).written,0,'Common stamps must not rewrite entry buckets');verifyApartmentEntries(root);assert.equal(entry(source).updated,'changed');
  catalog.sources={'data/index.json':'c'.repeat(64)};catalog.shards['data/apartments/00.json']='d'.repeat(64);put('data/apartments/index.json',catalog);
  assert.equal(buildApartmentEntries(root).written,0,'A changed DTO shard hash must not rewrite routing buckets');verifyApartmentEntries(root);assert.equal(entry(source).lookup[source][2],'d'.repeat(64));
  const before=index().sources;catalog.lookup['added-alias']=['public','00'];put('data/apartments/index.json',catalog);assert.equal(buildApartmentEntries(root).written,1,'Only a new alias routing bucket changes');
  assert.deepEqual(Object.keys(before).filter(path=>before[path]!==index().sources[path]),['data/apartments/entry/'+(parseInt(hash('added-alias').slice(0,2),16)&63).toString(16).padStart(2,'0')+'.json']);verifyApartmentEntries(root);
 }finally{const resolved=realpathSync(root),base=realpathSync(tmpdir());if(!resolved.startsWith(base+sep)||!resolved.slice(base.length+1).startsWith('common-entry-'))throw Error('Unsafe test cleanup');rmSync(resolved,{recursive:true,force:true});}
});

test('entry readers verify only selected buckets, retry failures and retain schema 2 compatibility',async()=>{
 const bytes=Buffer.from(JSON.stringify({schema:3,lookup:{one:['one','00']},legacy:{0:['one','00',104]},routes:{one:null}})),bucket=(parseInt(hash('one').slice(0,2),16)&63).toString(16).padStart(2,'0'),path='data/apartments/entry/'+bucket+'.json';
 const index={schema:3,metadata:{version:2,format:'packed-records-v1',updated:'now',sources:{}},basis:{sale:'a',rental:'b'},shards:{'data/apartments/00.bin':'c'.repeat(64),'data/apartments/summary/00.bin':'d'.repeat(64)},sources:{[path]:hash(bytes)}};
 const calls=[];let fail=true;const reader=createApartmentEntryReader(async requested=>{calls.push(requested);if(requested.endsWith('entry-index.json'))return Buffer.from(JSON.stringify(index));if(fail){fail=false;return Buffer.from('{}');}return bytes;});
 await assert.rejects(reader('one'),/source changed/);const [one,two]=await Promise.all([reader('one'),reader('one')]);assert.equal(one,two);assert.deepEqual(one.legacy[0],['one','data/apartments/00.bin','c'.repeat(64),104]);assert.equal(calls.filter(p=>p.endsWith('entry-index.json')).length,1);assert.equal(calls.length,3);
 const legacy={schema:2,lookup:{one:['one','data/apartments/00.json','e'.repeat(64)]},routes:{one:null},basis:{sale:'a',rental:'b'}};
 const old=createApartmentEntryReader(async requested=>{if(requested.endsWith('entry-index.json'))throw Object.assign(Error('old release'),{status:404});return Buffer.from(JSON.stringify(legacy));});assert.deepEqual(await old('one'),legacy);
});
