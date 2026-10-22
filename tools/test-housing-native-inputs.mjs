import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {VerifiedNativeInputs} from './housing-native-inputs.mjs';
import {createNativeReaders} from './housing-native-readers.mjs';
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
 const site=join(base,'site'),scratch=join(base,'native'),code='11110',month='2026-10',region='data/daily/regions/'+code;
 const emit=(root,p,v)=>{const b=p.endsWith('.bin')?gzipSync(JSON.stringify(v)):Buffer.from(JSON.stringify(v));mkdirSync(join(root,p,'..'),{recursive:true});writeFileSync(join(root,p),b);return createHash('sha256').update(b).digest('hex');};
 emit(site,region+'/identities.json',{complexes:['source'],areas:[[0,'59.1']]});emit(site,region+'/metadata.json',{complexes:[{id:'source',r:1}],areas:[]});emit(site,'data/daily/regions/index.json',{schema:3,regions:{[code]:{identities:region+'/identities.json',metadata:region+'/metadata.json'}}});
 for(const kind of ['daily','rental']){
  emit(site,'data/'+kind+'/index.json',{schema:2,sources:{}});
  const p=kind==='daily'?'data/daily/1/2026-10.bin':'data/rental/months/2026-10-11.bin',sources={};sources[p]=emit(scratch,p,{rows:[[0,123]]});sources[p.replace('.bin','-state.bin')]=emit(scratch,p.replace('.bin','-state.bin'),{opening:[[0,456]],updates:[[0,789]]});emit(scratch,'data/'+kind+'/index.json',{months:[month],sources});
 }
 const spec={generated:{[code]:scratch}},created=createNativeReaders(spec,site,null),readers=created.readers;
 for(const kind of ['daily','rental']){assert.deepEqual(readers[kind].regionMonth(code,month),{rows:[[code+':0',123]],opening:[[code+':0',456]],updates:[[code+':0',789]]});assert.deepEqual(readers.regionOpening(kind,code,month),[[code+':0',456]]);}
 for(const fingerprint of [readers.regionFingerprint(code),readers.periodFingerprint(code,[month]),readers.stateFingerprint(code,[month])])assert.match(fingerprint,/^[a-f0-9]{64}$/);
 readers.verify();emit(scratch,'data/daily/1/2026-10.bin',{rows:[[0,124]]});assert.throws(()=>readers.verify(),/changed during packing/);
 console.log('PASS: native input reuse, conflicting hash, live-byte mutation, bounded memory');
} finally {rmSync(base,{recursive:true});}
