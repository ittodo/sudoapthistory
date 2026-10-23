import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {gzipSync} from 'node:zlib';

const source=readFileSync(new URL('../js/verified-data-cache.js',import.meta.url),'utf8');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const path='data/daily/regions/11110/quarters/2026-Q3.bin';
function backend(){
 const stores=new Map();
 return {stores,caches:{open:async name=>{
  if(!stores.has(name))stores.set(name,new Map());const values=stores.get(name);
  return {match:async key=>values.get(key)?.clone(),put:async(key,response)=>{values.set(key,response.clone());},keys:async()=>[...values.keys()],delete:async key=>values.delete(key)};
 }}};
}
function runtime(fetch,storage=backend()){
 const context=vm.createContext({Response,Blob,TextDecoder,Uint8Array,DecompressionStream,AbortController,crypto:webcrypto,caches:storage.caches,fetch});
 vm.runInContext(source,context);return {api:context.NodoVerifiedDataCache,...storage};
}
function gate(){let start,release;return {started:new Promise(resolve=>start=resolve),waiting:new Promise(resolve=>release=resolve),start,release};}

test('same public file requests share work while each subscriber can cancel independently',async()=>{
 const bytes=Buffer.from('packed-quarter'),expected=hash(bytes),hold=gate();let calls=0,aborted=0;
 const {api}=runtime(async(url,{signal,credentials})=>{calls++;assert.equal(credentials,'omit');signal.addEventListener('abort',()=>aborted++);hold.start();await hold.waiting;return new Response(bytes);});
 const first=api.createHousing(),second=api.createHousing(),cancel=new AbortController();
 const discarded=first.download(path,expected,{signal:cancel.signal}),kept=second.download(path,expected);
 const rejected=assert.rejects(discarded,error=>error.name==='AbortError');await hold.started;cancel.abort();await rejected;
 assert.equal(aborted,0,'one subscriber cannot abort another subscriber');hold.release();
 assert.deepEqual(Buffer.from(await kept),bytes);assert.equal(calls,1);
});

test('all cancelled subscribers abort the fetch and an immediate retry starts fresh',async()=>{
 const bytes=Buffer.from('retry-quarter'),expected=hash(bytes),hold=gate();let calls=0,aborted=0;
 const {api}=runtime(async(url,{signal})=>{if(++calls===1){hold.start();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(signal.reason);},{once:true}));}return new Response(bytes);});
 const disk=api.createHousing(),a=new AbortController(),b=new AbortController();
 const pa=disk.download(path,expected,{signal:a.signal}),pb=disk.download(path,expected,{signal:b.signal});
 const rejected=Promise.all([assert.rejects(pa,error=>error.name==='AbortError'),assert.rejects(pb,error=>error.name==='AbortError')]);
 await hold.started;a.abort();b.abort();const retry=disk.download(path,expected);await rejected;
 assert.deepEqual(Buffer.from(await retry),bytes);assert.equal(calls,2);assert.equal(aborted,1);
});

test('persistent public bytes are reused across runtimes, hash versions remain separate and corrupt entries refetch',async()=>{
 const storage=backend(),a=Buffer.from('quarter-a'),b=Buffer.from('quarter-b');let current=a,calls=0;
 const fetch=async()=>{calls++;return new Response(current);};
 await runtime(fetch,storage).api.createHousing().download(path,hash(a));
 await runtime(fetch,storage).api.createHousing().download(path,hash(a));assert.equal(calls,1);
 current=b;await runtime(fetch,storage).api.createHousing().download(path,hash(b));assert.equal(calls,2);
 const values=storage.stores.get('nodo-housing-files-v1');assert.equal(values.size,2);
 const key='/'+path+'?v='+hash(b);values.set(key,new Response('corrupt',{headers:{'Content-Length':'7'}}));
 assert.deepEqual(Buffer.from(await runtime(fetch,storage).api.createHousing().download(path,hash(b))),b);assert.equal(calls,3);
});

test('byte and entry budgets evict older files; concurrent writers remain bounded and oversize files are not stored',async()=>{
 const files=new Map(Array.from({length:12},(_,i)=>['data/cache/'+i+'.bin',Buffer.alloc(4,i)]));
 files.set('data/cache/large.bin',Buffer.alloc(11,99));
 const {api,stores}=runtime(async url=>new Response(files.get(url.slice(1).split('?')[0])));
 const bytes=api.create('bytes',10,{maxBytes:10});
 for(const p of ['data/cache/0.bin','data/cache/1.bin','data/cache/2.bin'])await bytes.download(p,hash(files.get(p)));
 const retained=stores.get('bytes');assert.equal(retained.size,2);assert.ok(![...retained.keys()].some(p=>p.includes('/0.bin?')));
 const bounded=api.create('concurrent',2,{maxBytes:10});
 await Promise.all([...files].map(([p,b])=>bounded.download(p,hash(b))));
 const values=stores.get('concurrent');assert.ok(values.size<=2);assert.ok([...values.values()].reduce((n,r)=>n+Number(r.headers.get('Content-Length')),0)<=10);assert.ok(![...values.keys()].some(p=>p.includes('/large.bin?')));
});

test('range keys share identical sections and keep different sections separate',async()=>{
 const whole=Buffer.from('012345678901abcdefghijkl'),a=whole.subarray(12,18),b=whole.subarray(18,24),expected=hash(whole),hold=gate();let calls=0;
 const {api}=runtime(async(url,{headers})=>{calls++;hold.start();await hold.waiting;const [,from,to]=headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number);return new Response(whole.subarray(from,to+1),{status:206,headers:{'Content-Range':`bytes ${from}-${to}/${whole.length}`}});});
 const range=(offset,bytes)=>({offset,length:bytes.length,total:whole.length,sha256:hash(bytes)}),disk=api.createHousing();
 const values=[disk.download(path,expected,{range:range(12,a)}),disk.download(path,expected,{range:range(12,a)}),disk.download(path,expected,{range:range(18,b)})];
 await hold.started;hold.release();const result=await Promise.all(values);assert.equal(calls,2);assert.deepEqual(result.map(value=>Buffer.from(value)),[a,a,b]);
});

test('only hashed public data files are accepted and new record BIN retains the JSON fallback',async()=>{
 let fetched=0;const {api}=runtime(async()=>{fetched++;return new Response('');}),disk=api.createHousing();
 for(const p of ['api/me','https://example.com/data/a.bin','data/../api/me','data/%2e%2e/api/me','data/a.bin?private=1','data/a\\b.bin'])await assert.rejects(disk.download(p,'a'.repeat(64)),/public file/);
 await assert.rejects(disk.download('data/apartments/bucket.bin','wrong'),/public file/);assert.equal(fetched,0);
 assert.throws(()=>api.create('invalid',1,{maxBytes:Infinity}),/budget/);
 const packed=Buffer.from('PGRCD001example');assert.deepEqual(Buffer.from(await api.decode(gzipSync(packed),'data/apartments/bucket.bin')),packed);
 assert.deepEqual(JSON.parse(JSON.stringify(await api.decode(gzipSync('{"legacy":true}'),'data/apartments/legacy.bin'))),{legacy:true});
});
