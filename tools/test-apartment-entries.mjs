import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {join,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {buildApartmentEntries} from './build-apartment-entries.mjs';
import {verifyApartmentEntries} from './verify-apartment-entries.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('direct entries use actual region identity, preserve aliases/legacy links and detect stale owners',()=>{
 const root=mkdtempSync(join(tmpdir(),'common-entry-')),put=(p,v)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),JSON.stringify(v));};
 try{const source='99999-source',catalog={version:2,updated:'fixture',lookup:{public:['public','00'],[source]:['public','00'],empty:['empty','01']},legacy:{7:['public',59]},sources:{},shards:{'data/apartments/00.json':'a'.repeat(64),'data/apartments/01.json':'b'.repeat(64)}};
  put('data/apartments/index.json',catalog);put('data/sale-details/index.json',{format:'sale-fact-references'});put('data/apartment-rent/index.json',{schema:2});put('data/daily/regions/index.json',{regions:{11110:{identities:'data/daily/regions/11110/identities.json'}}});put('data/daily/regions/11110/identities.json',{complexes:[source],areas:[]});
  const built=buildApartmentEntries(root);assert.equal(built.written,64);assert.equal(buildApartmentEntries(root).written,0);verifyApartmentEntries(root);
  const entry=id=>JSON.parse(readFileSync(join(root,'data/apartments/entry/'+(parseInt(hash(id).slice(0,2),16)&63).toString(16).padStart(2,'0')+'.json')));
  assert.deepEqual(entry(source).routes[source],{region:'11110',local:0});assert.equal(entry('empty').routes.empty,null);assert.deepEqual(entry('row:7').legacy[7],['public','data/apartments/00.json','a'.repeat(64),59]);
  catalog.updated='changed';put('data/apartments/index.json',catalog);assert.throws(()=>verifyApartmentEntries(root),/basis/);
 }finally{const resolved=realpathSync(root),base=realpathSync(tmpdir());if(!resolved.startsWith(base+sep)||!resolved.slice(base.length+1).startsWith('common-entry-'))throw Error('Unsafe test cleanup');rmSync(resolved,{recursive:true,force:true});}
});
