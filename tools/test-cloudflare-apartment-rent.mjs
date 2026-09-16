import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {buildApartmentRent} from './build-apartment-rent.mjs';
import {verifyApartmentRent} from './verify-apartment-rent.mjs';
import vm from 'node:vm';
test('rental publication joins only confirmed source identities and rejects missing or changed partitions',()=>{
 const root=mkdtempSync(join(tmpdir(),'nodo-rent-test-'));
 const put=(p,j)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),JSON.stringify(j));};
 try{
  put('data/apartments/index.json',{lookup:{'11110-1':['canonical','aa']}});
  const path='apartment-rent/11110/202609.json';
  const rows=[{aptSeq:'11110-1',area:84.98,date:'2026-09-02',deposit:50000,category:'jeonse'},{aptSeq:'11110-99',name:'same name',area:84.98,date:'2026-09-02'}];
  put('data/contracts/'+path,{rows});put('data/contracts/index.json',{partitions:[{service:'apartment-rent',lawd:'11110',month:'202609',path,count:2,checkedAt:'2026-09-14'}]});
  assert.equal(buildApartmentRent(root).linked,1);assert.equal(buildApartmentRent(root,{verify:true}).total,2);
  assert.equal(verifyApartmentRent(root).linked,1);
  const output=JSON.parse(readFileSync(join(root,'data/apartment-rent/aa.json')));assert.equal(output.canonical.rows[0].area,84.98);assert.equal(output.canonical.rows.length,1);
  put('data/contracts/'+path,{rows:[...rows,{aptSeq:'11110-1'}]});assert.throws(()=>buildApartmentRent(root,{verify:true}),/count mismatch/);assert.throws(()=>verifyApartmentRent(root),/out of date/);
  put('data/contracts/'+path,{rows:rows.map(r=>({...r,deposit:1}))});assert.throws(()=>buildApartmentRent(root,{verify:true}),/out of date/);
  rmSync(join(root,'data/contracts/'+path));assert.throws(()=>buildApartmentRent(root),/ENOENT/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('deployment rent verifier checks shard hashes and rejects unsafe or missing sources',()=>{
 const root=mkdtempSync(join(tmpdir(),'nodo-rent-hashes-'));
 const put=(p,j)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),JSON.stringify(j));};
 try {
  const path='apartment-rent/11110/202609.json';
  put('data/apartments/index.json',{lookup:{a:['canonical','aa']}});
  put('data/contracts/'+path,{rows:[{aptSeq:'a',area:84.98,date:'2026-09-01'}]});
  put('data/contracts/index.json',{partitions:[{path,service:'apartment-rent',lawd:'11110',month:'202609',count:1,checkedAt:null}]});
  buildApartmentRent(root);
  const original=readFileSync(join(root,'data/apartment-rent/aa.json'));
  writeFileSync(join(root,'data/apartment-rent/aa.json'),'{}');
  assert.throws(()=>verifyApartmentRent(root),/out of date/);
  writeFileSync(join(root,'data/apartment-rent/aa.json'),original);
  const index=JSON.parse(readFileSync(join(root,'data/apartment-rent/index.json')));
  index.shards['data/apartment-rent/../../outside.json']='a'.repeat(64);
  put('data/apartment-rent/index.json',index);
  assert.throws(()=>verifyApartmentRent(root),/Invalid rent shard/);
  buildApartmentRent(root);
  rmSync(join(root,'data/contracts/'+path));
  assert.throws(()=>verifyApartmentRent(root),/ENOENT/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('recent rental period crosses the calendar year without adding future months',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(readFileSync(new URL('../js/apartment-rent.js',import.meta.url),'utf8'),context);
 const now=new Date(2026,0,15);assert.deepEqual(Array.from(context.window.NodoRent.months('recent',now)),['202502','202503','202504','202505','202506','202507','202508','202509','202510','202511','202512','202601']);assert.deepEqual(Array.from(context.window.NodoRent.months('2026',now)),['202601']);
});
test('deployment rent verifier requires every referenced shard and accepts empty input',()=>{
 const root=mkdtempSync(join(tmpdir(),'nodo-rent-complete-'));
 const put=(p,j)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),JSON.stringify(j));};
 try {
  put('data/apartments/index.json',{lookup:{a:['canonical','aa']}});
  put('data/contracts/index.json',{partitions:[]});
  buildApartmentRent(root);
  assert.equal(verifyApartmentRent(root).files,1);
  const partition='apartment-rent/11110/202609.json';
  put('data/contracts/'+partition,{rows:[{aptSeq:'a',area:84,date:'2026-09-01'}]});
  put('data/contracts/index.json',{partitions:[{path:partition,service:'apartment-rent',lawd:'11110',month:'202609',count:1,checkedAt:null}]});
  buildApartmentRent(root);
  assert.equal(verifyApartmentRent(root).files,2);
  const path='data/apartment-rent/index.json';
  const original=JSON.parse(readFileSync(join(root,path)));
  put(path,{...original,shards:{}});
  assert.throws(()=>verifyApartmentRent(root),/shard set mismatch/);
  put(path,{...original,records:{}});
  assert.throws(()=>verifyApartmentRent(root),/shard set mismatch/);
  put(path,original);
  rmSync(join(root,'data/apartment-rent/aa.json'));
  assert.throws(()=>verifyApartmentRent(root),/ENOENT/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
