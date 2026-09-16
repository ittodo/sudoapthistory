import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {buildApartmentData} from './build-apartment-data.mjs';
import {verifyApartmentSale} from './verify-apartment-sale.mjs';

test('sale artifact integrity verifier accepts oracle bytes and rejects changed inputs, outputs and missing shards',()=>{
 const root=mkdtempSync(join(tmpdir(),'nodo-sale-verify-'));
 const put=(path,value)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),JSON.stringify(value));};
 try {
  put('data/index.json',{meta:{updated:'2026-09-16'},d:[{i:0,as:'source',r:1,g:'강남구',d:'역삼동',j:'1',n:'단지',a:84.0,b:2000}]});
  put('data/map/index.json',{d:[]});
  put('data/housing-v3/index.json',{meta:{approvedOnly:true},complexes:[]});
  put('data/tx/강남구.json',{entries:{'0':{'2026':[[9,1,50000,3]]}}});
  buildApartmentData(root);assert.equal(verifyApartmentSale(root).count,1);
  const index=JSON.parse(readFileSync(join(root,'data/apartments/index.json')));
  const [path]=Object.keys(index.shards),original=readFileSync(join(root,path));
  writeFileSync(join(root,path),'{"changed":true}');assert.throws(()=>verifyApartmentSale(root),/out of date/);
  writeFileSync(join(root,path),original);
  const tx=readFileSync(join(root,'data/tx/강남구.json'));
  put('data/tx/강남구.json',{entries:{}});assert.throws(()=>verifyApartmentSale(root),/out of date/);
  writeFileSync(join(root,'data/tx/강남구.json'),tx);
  rmSync(join(root,path));assert.throws(()=>verifyApartmentSale(root),/ENOENT/);
  writeFileSync(join(root,path),original);
  delete index.shards[path];index.shards['data/apartments/../../outside.json']='a'.repeat(64);
  put('data/apartments/index.json',index);assert.throws(()=>verifyApartmentSale(root),/out of date/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
