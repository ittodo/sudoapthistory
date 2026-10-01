import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
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
