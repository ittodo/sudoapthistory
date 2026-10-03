import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {VerifiedNativeInputs} from './housing-native-inputs.mjs';
const base=mkdtempSync(join(tmpdir(),'native-input-test-')),path=join(base,'month.bin');
const bytes=gzipSync(JSON.stringify({rows:[[0,20261002,123,null]],opening:[],updates:[]}));
const hash=createHash('sha256').update(bytes).digest('hex');writeFileSync(path,bytes);
try {
 const r=new VerifiedNativeInputs();assert.equal(r.check(path,hash),hash);
 const first=r.json(path,hash);assert.equal(r.json(path,hash),first);r.check(path,hash);
 assert.equal(r.metrics.decodes,1);assert.equal(r.metrics.parsedHits,1);assert.equal(r.metrics.fingerprintHits,1);r.verify();
 assert.throws(()=>r.json(path,'0'.repeat(64)),/digest conflict/);
 writeFileSync(path,gzipSync('{"rows":[]}'));assert.throws(()=>r.verify(),/changed during packing/);
 const limited=new VerifiedNativeInputs({maxParsedBytes:0});limited.json(path);limited.json(path);
 assert.equal(limited.metrics.parsedHits,0);assert.equal(limited.metrics.peakParsedBytes,0);
 assert.throws(()=>new VerifiedNativeInputs({maxParsedBytes:-1}),/memory budget/);
 console.log('PASS: native input reuse, conflicting hash, live-byte mutation, bounded memory');
} finally {rmSync(base,{recursive:true});}
