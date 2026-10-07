import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {ValidationSession,manifestDependencies} from './validation-session.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(fn){const root=mkdtempSync(join(tmpdir(),'nodo-validation-'));try{return fn(root);}finally{rmSync(root,{recursive:true,force:true});}}
test('successful scopes survive restart; changed scope, engine and full mode require fresh checks',()=>fixture(root=>{
 let calls=0;const verify=()=>{calls++;return {status:'PASS',rows:2};};
 let s=new ValidationSession(root,{engine:'a'});s.check('region/11',{q:'one'},verify);s.check('region/41',{q:'two'},verify);s.flush();
 s=new ValidationSession(root,{engine:'a'});s.check('region/11',{q:'one'},verify);s.check('region/41',{q:'three'},verify);assert.equal(calls,3);assert.deepEqual(s.stats,{checked:1,reused:1});s.flush();
 s=new ValidationSession(root,{engine:'b'});s.check('region/11',{q:'one'},verify);assert.equal(calls,4);
 s=new ValidationSession(root,{engine:'a',full:true});s.check('region/11',{q:'one'},verify);assert.equal(calls,5);
}));
test('failed checks cannot stamp PASS; corrupted receipt requires revalidation',()=>fixture(root=>{
 const s=new ValidationSession(root,{engine:'a'});assert.throws(()=>s.check('scope',{},()=>{throw Error('bad');}),/bad/);assert.equal(s.records.scope,undefined);
 assert.throws(()=>s.check('scope',{},()=>({status:'FAIL'})),/did not PASS/);
 s.check('scope',{},()=>({status:'PASS'}));s.flush();const file=join(root,'cloudflare/dist/validation-cache-v1/receipts.json');const proof=JSON.parse(readFileSync(file));proof.records.scope.result.rows=999;writeFileSync(file,JSON.stringify(proof));
 const next=new ValidationSession(root,{engine:'a'});next.check('scope',{},()=>({status:'PASS',rows:1}));assert.equal(next.stats.checked,1);
}));
test('current bytes must match manifests even when successful receipts exist',()=>fixture(root=>{
 mkdirSync(join(root,'data'));writeFileSync(join(root,'data/q.bin'),'original');writeFileSync(join(root,'data/index.json'),JSON.stringify({sources:{'data/q.bin':hash('original')}}));
 const s=new ValidationSession(root,{engine:'a'});s.check('scope',manifestDependencies(root,['data/index.json']),()=>({status:'PASS'}));s.flush();
 writeFileSync(join(root,'data/q.bin'),'damaged');assert.throws(()=>manifestDependencies(root,['data/index.json']),/source mismatch/);
 writeFileSync(join(root,'data/index.json'),JSON.stringify({sources:{'data/../outside':hash('original')}}));assert.throws(()=>manifestDependencies(root,['data/index.json']),/Unsafe/);
}));

test('nested validation sessions preserve all successful scopes',()=>fixture(root=>{
 const outer=new ValidationSession(root,{engine:'a'}),inner=new ValidationSession(root,{engine:'a'});
 inner.check('region',{},()=>({status:'PASS'}));inner.flush();outer.check('details',{},()=>({status:'PASS'}));outer.flush();
 const next=new ValidationSession(root,{engine:'a'});next.check('region',{},()=>{throw Error('lost region');});next.check('details',{},()=>{throw Error('lost details');});assert.equal(next.stats.reused,2);
}));

test('apartment DTO shard bytes are verified independently of unchanged index bytes',()=>fixture(root=>{
 mkdirSync(join(root,'data'));writeFileSync(join(root,'data/shard.json'),'original');writeFileSync(join(root,'data/index.json'),JSON.stringify({sources:{},shards:{'data/shard.json':hash('original')}}));
 manifestDependencies(root,['data/index.json']);writeFileSync(join(root,'data/shard.json'),'corrupt');assert.throws(()=>manifestDependencies(root,['data/index.json']),/source mismatch/);
}));

import {createDataValidationProof,dataValidationProof,proofManifests,proofPath} from './data-validation-proof.mjs';
test('producer completion record binds all current manifest bytes and is bypassed by full mode',()=>fixture(root=>{
 for(const path of proofManifests){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),JSON.stringify({sources:{}}));}
 assert.equal(dataValidationProof(root).status,'MISSING');
 const checks={status:'PASS',schema:3,sales:{status:'PASS',rows:2,excluded:0},details:{status:'PASS',contracts:3,unmatched:0},apartment:{verified:true}};
 createDataValidationProof(root,checks);assert.equal(dataValidationProof(root).status,'VERIFIED');assert.equal(dataValidationProof(root,{full:true}).status,'FULL_REQUIRED');
 writeFileSync(join(root,proofManifests[0]),JSON.stringify({sources:{},changed:true}));assert.equal(dataValidationProof(root).status,'INPUT_CHANGED');
 createDataValidationProof(root,checks);const file=join(root,proofPath),p=JSON.parse(readFileSync(file));p.checks.saleRows=999;writeFileSync(file,JSON.stringify(p));assert.equal(dataValidationProof(root).status,'INVALID');
 assert.throws(()=>createDataValidationProof(root,{...checks,status:'FAIL'}),/verified housing/);
}));


import {validationEngine,fullValidationEngine} from './validation-session.mjs';
test('scoped engine follows transitive code but ignores unrelated UI and tests',()=>fixture(root=>{
 mkdirSync(join(root,'tools'));mkdirSync(join(root,'js'));writeFileSync(join(root,'tools/check.mjs'),"import './model.mjs';");writeFileSync(join(root,'tools/model.mjs'),"export const value=1;");writeFileSync(join(root,'js/ui.js'),'before');
 const options={roots:['tools/check.mjs']},first=validationEngine(root,options);writeFileSync(join(root,'js/ui.js'),'after');assert.equal(validationEngine(root,options),first);
 writeFileSync(join(root,'tools/model.mjs'),'export const value=2;');assert.notEqual(validationEngine(root,options),first);
 writeFileSync(join(root,'tools/model.mjs'),'import(variable);');assert.equal(validationEngine(root,options),fullValidationEngine(root));
}));


test('shared manifest inputs are hashed once per call and conflicts still fail',()=>fixture(root=>{
 mkdirSync(join(root,'data'));writeFileSync(join(root,'data/shared.bin'),'original');
 const first={sources:{'data/shared.bin':hash('original')}};
 for(const name of ['one','two'])writeFileSync(join(root,`data/${name}.json`),JSON.stringify(first));
 const stats={},inputs=manifestDependencies(root,['data/one.json','data/two.json'],{stats});
 assert.deepEqual(Object.keys(inputs),['data/one.json','data/shared.bin','data/two.json']);
 assert.equal(stats.references,4);assert.equal(stats.reads,3);assert.equal(stats.reused,1);
 writeFileSync(join(root,'data/two.json'),JSON.stringify({shards:{'data/shared.bin':hash('other')}}));
 assert.throws(()=>manifestDependencies(root,['data/one.json','data/two.json']),/source mismatch/);
 // A fresh call always hashes current bytes, even if the previous call passed.
 writeFileSync(join(root,'data/shared.bin'),'modified');
 assert.throws(()=>manifestDependencies(root,['data/one.json']),/source mismatch/);
}));

test('dependency manifest names cannot escape data or be symlinks',()=>fixture(root=>{
 mkdirSync(join(root,'data'));writeFileSync(join(root,'outside.json'),'{}');
 for(const path of ['../outside.json','data/../outside.json','outside.json','data/./a.json','data\\a.json'])
  assert.throws(()=>manifestDependencies(root,[path]),/Unsafe/);
}));


test('mutation after hashing a shared dependency is rejected at the end',()=>fixture(root=>{
 mkdirSync(join(root,'data'));writeFileSync(join(root,'data/shared.bin'),'original');
 for(const name of ['one','two'])writeFileSync(join(root,`data/${name}.json`),JSON.stringify({sources:{'data/shared.bin':hash('original')}}));
 const stats=new Proxy({},{set(target,key,value){target[key]=value;if(key==='reads'&&value===3)writeFileSync(join(root,'data/shared.bin'),'changed!');return true;}});
 assert.throws(()=>manifestDependencies(root,['data/one.json','data/two.json'],{stats}),/changed during validation/);
}));

test('a manifest referenced as another shard is still read only once',()=>fixture(root=>{
 mkdirSync(join(root,'data'));const second=JSON.stringify({sources:{}});writeFileSync(join(root,'data/two.json'),second);
 writeFileSync(join(root,'data/one.json'),JSON.stringify({sources:{'data/two.json':hash(second)}}));
 const stats={};manifestDependencies(root,['data/one.json','data/two.json'],{stats});assert.equal(stats.reads,2);assert.equal(stats.reused,1);
}));


test('nested directory junctions cannot redirect dependency reads',()=>fixture(root=>{
 mkdirSync(join(root,'data'));mkdirSync(join(root,'other'));writeFileSync(join(root,'other/q.bin'),'original');
 symlinkSync(join(root,'other'),join(root,'data/alias'),process.platform==='win32'?'junction':'dir');
 writeFileSync(join(root,'data/index.json'),JSON.stringify({sources:{'data/alias/q.bin':hash('original')}}));
 assert.throws(()=>manifestDependencies(root,['data/index.json']),/symlink/);
}));

test('directory replacement after a shared read cannot retain a successful proof',()=>fixture(root=>{
 mkdirSync(join(root,'data'));mkdirSync(join(root,'data/parts'));writeFileSync(join(root,'data/parts/q.bin'),'original');
 for(const name of ['one','two'])writeFileSync(join(root,`data/${name}.json`),JSON.stringify({sources:{'data/parts/q.bin':hash('original')}}));
 const stats=new Proxy({},{set(target,key,value){target[key]=value;if(key==='reads'&&value===3){renameSync(join(root,'data/parts'),join(root,'data/old-parts'));mkdirSync(join(root,'data/parts'));writeFileSync(join(root,'data/parts/q.bin'),'original');}return true;}});
 assert.throws(()=>manifestDependencies(root,['data/one.json','data/two.json'],{stats}),/directory changed/);
}));

test('independent checker engines keep receipts when an unrelated checker changes',()=>fixture(root=>{
 mkdirSync(join(root,'tools'));writeFileSync(join(root,'tools/a.mjs'),'export const n=1;');writeFileSync(join(root,'tools/b.mjs'),'export const n=1;');
 const a={roots:['tools/a.mjs']},b={roots:['tools/b.mjs']};
 for(const opts of [a,b]){const s=new ValidationSession(root,opts);s.check('same-scope',{},()=>({status:'PASS'}));s.flush();}
 writeFileSync(join(root,'tools/b.mjs'),'export const n=2;');
 const warm=new ValidationSession(root,a);warm.check('same-scope',{},()=>{throw Error('unrelated checker expired receipt');});assert.equal(warm.stats.reused,1);
 const cold=new ValidationSession(root,b);cold.check('same-scope',{},()=>({status:'PASS'}));assert.equal(cold.stats.checked,1);
}));

test('actual detail producers exclude checker orchestration but include fact restoration code',()=>fixture(root=>{
 const origin=new URL('../',import.meta.url),seen=new Set();
 function copy(name){if(seen.has(name))return;seen.add(name);const source=new URL(name,origin),bytes=readFileSync(source),dest=join(root,name);mkdirSync(join(dest,'..'),{recursive:true});writeFileSync(dest,bytes);for(const m of bytes.toString().matchAll(/['"](\.{1,2}\/[^'"\n]+\.(?:m?js|cjs|json))['"]/g)){const next=new URL(m[1],source).pathname;const base=origin.pathname;copy(decodeURIComponent(next.slice(base.length)));}}
 copy('tools/build-housing-sales.mjs');copy('tools/build-housing-details.mjs');
 for(const name of ['build-housing-sales.mjs','build-housing-details.mjs']){const options={roots:['tools/'+name]},first=validationEngine(root,options);assert.notEqual(first,fullValidationEngine(root));writeFileSync(join(root,'tools/validation-session.mjs'),'changed checker orchestration');assert.equal(validationEngine(root,options),first);}
 const options={roots:['tools/build-housing-sales.mjs']},first=validationEngine(root,options);writeFileSync(join(root,'js/housing-sale-detail.mjs'),'changed actual fact restoration');assert.notEqual(validationEngine(root,options),first);
}));
