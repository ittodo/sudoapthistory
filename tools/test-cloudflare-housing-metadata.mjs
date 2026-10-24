import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,statSync,utimesSync,truncateSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {build,publicAsset} from './build-cloudflare-assets.mjs';
import {closeCacheStores} from './cache-store.mjs';
import {housingMetadataTransport} from './housing-metadata-transport.mjs';
import {decodeHousingMetadata,loadHousingMetadata} from '../js/housing-metadata.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function transport(value){const raw=Buffer.from(JSON.stringify(value)),bytes=gzipSync(raw),sha256=hash(raw);return {raw,bytes,manifest:{schema:1,format:'gzip-json-v1',source:{path:'data/housing-v3/index.json',sha256,bytes:raw.length},file:{path:`data/housing-v3/index.${sha256}.bin`,sha256:hash(bytes),bytes:bytes.length}}};}

test('oversized producer metadata is preserved and only exact compressed transport is published and reused',()=>{
 const root=mkdtempSync(join(tmpdir(),'housing-transport-')),previous=process.env.NODO_CACHE_DB;
 try{
  process.env.NODO_CACHE_DB=join(root,'cloudflare/dist/housing-cache.sqlite');
  execFileSync('git',['init'],{cwd:root,stdio:'pipe'});writeFileSync(join(root,'.gitignore'),'cloudflare/dist/\n');
  mkdirSync(join(root,'data/housing-v3'),{recursive:true});writeFileSync(join(root,'index.html'),'<html><head></head><body></body></html>');
  const source=join(root,'data/housing-v3/index.json'),raw=Buffer.from(JSON.stringify({meta:{approvedOnly:true},complexes:[],padding:'a'.repeat(25*1024*1024)}));writeFileSync(source,raw);
  const output=join(root,'cloudflare/dist/public'),first=build(root,output,'a'.repeat(40)),manifest=JSON.parse(readFileSync(join(output,'data/housing-v3/transport.json'))),published=JSON.parse(readFileSync(join(output,'deployment-manifest.json')));
  assert.equal(publicAsset('data/housing-v3/index.json'),true,'raw JSON remains available to local preview');
  assert.ok(raw.length>25*1024*1024);assert.deepEqual(readFileSync(source),raw);assert.equal(existsSync(join(output,'data/housing-v3/index.json')),false);
  assert.equal(manifest.format,'gzip-json-v1');assert.equal(manifest.source.sha256,hash(raw));assert.equal(manifest.source.bytes,raw.length);
  const packed=readFileSync(join(output,manifest.file.path));assert.deepEqual(gunzipSync(packed),raw);assert.equal(hash(packed),manifest.file.sha256);assert.ok(packed.length<25*1024*1024);
  assert.equal(published.files.filter(f=>f.path.startsWith('data/housing-v3/')).length,2);
  for(const entry of published.files){const b=readFileSync(join(output,entry.path));assert.equal(entry.sha256,hash(b));assert.equal(entry.bytes,b.length);}
  assert.equal(first.housingMetadataStats.encoded,1);
  const headers=readFileSync(join(output,'_headers'),'utf8');assert.ok(headers.includes('/'+manifest.file.path+'\n  Cache-Control: public, max-age=31536000, immutable\n'));assert.doesNotMatch(headers,/\/data\/housing-v3\/\*/);
  const file=join(output,manifest.file.path);utimesSync(file,1000,1000);const stamp=statSync(file).mtimeMs;
  const next=build(root,output,'a'.repeat(40));assert.equal(next.housingMetadataStats.reused,1);assert.equal(next.written,0);assert.equal(statSync(file).mtimeMs,stamp);
  const captured=housingMetadataTransport(root);writeFileSync(source,Buffer.concat([raw,Buffer.from(' ')]));assert.throws(()=>captured.recheck(),/source changed/);
 }finally{closeCacheStores();if(previous===undefined)delete process.env.NODO_CACHE_DB;else process.env.NODO_CACHE_DB=previous;rmSync(root,{recursive:true,force:true});}
});

test('transport reader verifies compressed bytes and exact decompressed source bytes',async()=>{
 const value={meta:{contract:'current-review-publication-v1'},complexes:[{id:'ledger-one',units:null,name:'한글'}]},t=transport(value);
 assert.deepEqual(await decodeHousingMetadata(t.manifest,t.bytes),value);
 const wrongRaw=transport({...value,extra:true}),wrongBody={...t.manifest,file:{...t.manifest.file,sha256:hash(wrongRaw.bytes),bytes:wrongRaw.bytes.length}};
 await assert.rejects(decodeHousingMetadata(wrongBody,wrongRaw.bytes),/원문 크기/);
 const sameSize=transport({...value,complexes:[{id:'ledger-two',units:null,name:'한글'}]});assert.equal(sameSize.raw.length,t.raw.length);
 await assert.rejects(decodeHousingMetadata({...t.manifest,file:{...t.manifest.file,sha256:hash(sameSize.bytes),bytes:sameSize.bytes.length}},sameSize.bytes),/원문 해시/);
 await assert.rejects(decodeHousingMetadata(t.manifest,Buffer.concat([t.bytes,Buffer.from('x')])),/압축 자료/);
 await assert.rejects(decodeHousingMetadata({...t.manifest,file:{...t.manifest.file,path:'data/other.bin'}},t.bytes),/전송 목록 형식/);
});

test('producer and reader enforce the native raw and compressed size limits before expensive work',async()=>{
 const root=mkdtempSync(join(tmpdir(),'housing-transport-limit-'));
 try{
  mkdirSync(join(root,'data/housing-v3'),{recursive:true});const source=join(root,'data/housing-v3/index.json');writeFileSync(source,'{}');truncateSync(source,128*1024*1024+1);
  assert.throws(()=>housingMetadataTransport(root),/source exceeds 128 MiB/);assert.equal(existsSync(join(root,'cloudflare')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
 const {manifest}=transport({complexes:[]});
 for(const [part,limit] of [['source',128*1024*1024],['file',25*1024*1024]]){
  const atLimit={...manifest,[part]:{...manifest[part],bytes:limit}},overLimit={...manifest,[part]:{...manifest[part],bytes:limit+1}};let downloaded=0;
  const download=async()=>{downloaded++;throw Error('reached download');};
  await assert.rejects(loadHousingMetadata({fetcher:async()=>new Response(JSON.stringify(atLimit)),download}),/reached download/);assert.equal(downloaded,1);
  await assert.rejects(loadHousingMetadata({fetcher:async()=>new Response(JSON.stringify(overLimit)),download}),/전송 목록 형식/);assert.equal(downloaded,1,'oversized metadata must not start a download');
 }
});

test('only a missing transport manifest permits legacy JSON; failed or damaged transport never falls back',async()=>{
 const value={meta:{approvedOnly:true},complexes:[]},t=transport(value),calls=[];
 const fetcher=async path=>{calls.push(path);return new Response(JSON.stringify(t.manifest));};
 const result=await loadHousingMetadata({fetcher,download:async(path,digest)=>{assert.equal(path,t.manifest.file.path);assert.equal(digest,t.manifest.file.sha256);return t.bytes;}});
 assert.deepEqual(result,value);assert.deepEqual(calls,['/data/housing-v3/transport.json']);
 calls.length=0;
 assert.deepEqual(await loadHousingMetadata({fetcher:async path=>{calls.push(path);return path.endsWith('/transport.json')?new Response('',{status:404}):new Response(JSON.stringify(value));}}),value);
 assert.deepEqual(calls,['/data/housing-v3/transport.json','/data/housing-v3/index.json']);
 for(const response of [new Response('',{status:500}),new Response('{}')]){let count=0;await assert.rejects(loadHousingMetadata({fetcher:async()=>{count++;return response;}}));assert.equal(count,1);}
 let count=0;await assert.rejects(loadHousingMetadata({fetcher:async()=>{count++;return new Response(JSON.stringify(t.manifest));},download:async()=>new Uint8Array()}),/압축 자료/);assert.equal(count,1);
});
