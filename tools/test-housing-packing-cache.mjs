import{createHash}from'node:crypto';
const createDigest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
import{test}from'node:test';import assert from'node:assert/strict';import{mkdtempSync,rmSync,readFileSync,writeFileSync,realpathSync,readdirSync}from'node:fs';import{join,sep}from'node:path';import{tmpdir}from'node:os';import{packedMemo,identityDependencies}from'./housing-packing-cache.mjs';
test('verified packing cache reuses output but validates it again, and rejects corruption',()=>{const root=mkdtempSync(join(tmpdir(),'housing-cache-'));try{let made=0,checked=0;const make=emit=>{made++;emit('data/test.bin',Buffer.from('preserved'));return {path:'data/test.bin'};},validate=(r,files)=>{checked++;assert.equal(files.get(r.path).toString(),'preserved');},emit=()=>{};assert.equal(packedMemo(root,['a'],make,validate,emit).reused,false);assert.equal(packedMemo(root,['a'],make,validate,emit).reused,true);assert.equal(made,1);assert.equal(checked,2);const entry=join(root,readdirSync(root)[0],'0.bin');writeFileSync(entry,'corrupt');assert.throws(()=>packedMemo(root,['a'],make,validate,emit),/hash mismatch/);}finally{const p=realpathSync(root),t=realpathSync(tmpdir());if(!p.startsWith(t+sep)||!p.slice(t.length+1).startsWith('housing-cache-'))throw Error('Unsafe cleanup');rmSync(p,{recursive:true});}});
test('metadata and unrelated appended IDs do not invalidate a quarter cache dependency',()=>{const a={complexes:['source'],areas:[[0,'59.1']],name:'before'},b={complexes:['source','new source'],areas:[[0,'59.1'],[1,'80.9']],name:'after'},m={'2026-09':{daily:{rows:[['11110:0']],updates:[]},rental:{rows:[],updates:[]}}};assert.deepEqual(identityDependencies(a,m,'quarter'),identityDependencies(b,m,'quarter'));});

test('exact validated receipt reuses semantic check; new key, old receipt, full mode and damage do not',()=>{
 const root=mkdtempSync(join(tmpdir(),'housing-cache-'));const oldFull=process.env.NODO_FULL_VERIFY;
 try{
  delete process.env.NODO_FULL_VERIFY;let checks=0,made=0;
  const make=emit=>{made++;emit('data/test.bin',Buffer.from('preserved'));return {path:'data/test.bin'};};
  const validate=(r,f)=>{checks++;assert.equal(f.get(r.path).toString(),'preserved');};
  const run=(key='a')=>packedMemo(root,[key],make,validate,()=>{},{reuseValidation:true});
  assert.equal(run().validationReused,false);assert.equal(run().validationReused,true);assert.equal(checks,1);
  assert.equal(run('b').validationReused,false);assert.equal(checks,2);
  const directory=join(root,createDigest(['a'])),file=join(directory,'receipt.json');
  let receipt=JSON.parse(readFileSync(file));writeFileSync(file,JSON.stringify({schema:1,result:receipt.result,files:receipt.files}));
  assert.equal(run().validationReused,false);assert.equal(checks,3);assert.equal(run().validationReused,true);
  process.env.NODO_FULL_VERIFY='1';assert.equal(run().validationReused,false);assert.equal(checks,4);delete process.env.NODO_FULL_VERIFY;
  receipt=JSON.parse(readFileSync(file));receipt.result.path='data/changed.bin';writeFileSync(file,JSON.stringify(receipt));
  assert.throws(()=>run(),/receipt mismatch/);
  assert.equal(made,3);
 }finally{if(oldFull===undefined)delete process.env.NODO_FULL_VERIFY;else process.env.NODO_FULL_VERIFY=oldFull;rmSync(root,{recursive:true});}
});

test('failed semantic check never creates a reusable validation receipt',()=>{
 const root=mkdtempSync(join(tmpdir(),'housing-cache-'));
 try{
  const make=emit=>{emit('data/test.bin',Buffer.from('x'));return{path:'data/test.bin'};};
  assert.throws(()=>packedMemo(root,['failed'],make,()=>{throw Error('semantic mismatch');},()=>{},{reuseValidation:true}),/semantic mismatch/);
  assert.equal(readdirSync(root).length,0);
 }finally{rmSync(root,{recursive:true});}
});
