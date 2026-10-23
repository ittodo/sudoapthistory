import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {gzipSync} from 'node:zlib';

const source=readFileSync(new URL('../js/verified-data-cache.js',import.meta.url),'utf8');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const path='data/daily/regions/11110/quarters/2026-Q3.bin';
function backend({beforePut,requestKeys=false}={}){
 const stores=new Map(),stats={matches:0,puts:0};
 const keyOf=key=>(typeof key==='string'?key:key.url).replace(/^https?:\/\/[^/]+/,'');
 return {stores,stats,caches:{open:async name=>{
  if(!stores.has(name))stores.set(name,new Map());const values=stores.get(name);
  return {match:async key=>{stats.matches++;return values.get(keyOf(key))?.clone();},put:async(key,response)=>{stats.puts++;await beforePut?.();values.set(keyOf(key),response.clone());},keys:async()=>[...values.keys()].map(key=>requestKeys?{url:'https://nodostream.com'+key}:key),delete:async key=>values.delete(keyOf(key))};
 }}};
}
function runtime(fetch,storage=backend()){
 const context=vm.createContext({Response,Blob,TextDecoder,Uint8Array,DecompressionStream,AbortController,crypto:webcrypto,caches:storage.caches,fetch});
 vm.runInContext(source,context);return {api:context.NodoVerifiedDataCache,...storage};
}
function gate(){let start,release;return {started:new Promise(resolve=>start=resolve),waiting:new Promise(resolve=>release=resolve),start,release};}
const drain=()=>new Promise(resolve=>setImmediate(resolve));

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
 await drain();
 await runtime(fetch,storage).api.createHousing().download(path,hash(a));assert.equal(calls,1);
 current=b;await runtime(fetch,storage).api.createHousing().download(path,hash(b));assert.equal(calls,2);
 await drain();
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
 await drain();
 const retained=stores.get('bytes');assert.equal(retained.size,2);assert.ok(![...retained.keys()].some(p=>p.includes('/0.bin?')));
 const bounded=api.create('concurrent',2,{maxBytes:10});
 await Promise.all([...files].map(([p,b])=>bounded.download(p,hash(b))));
 await drain();
 const values=stores.get('concurrent');assert.ok(values.size<=2);assert.ok([...values.values()].reduce((n,r)=>n+Number(r.headers.get('Content-Length')),0)<=10);assert.ok(![...values.keys()].some(p=>p.includes('/large.bin?')));
});

test('verified bytes return before persistence, and pending storage reuses an immutable private copy',async()=>{
 const hold=gate(),bytes=Buffer.from('verified-before-storage');let calls=0;
 const storage=backend({beforePut:async()=>{hold.start();await hold.waiting;}});
 const {api}=runtime(async()=>{calls++;return new Response(bytes);},storage),disk=api.createHousing();
 try{
  const downloading=disk.download(path,hash(bytes));await hold.started;
  const result=await Promise.race([downloading.then(value=>({value})),drain().then(()=>null)]);
  assert.ok(result,'a gated cache.put must not block verified bytes');assert.deepEqual(Buffer.from(result.value),bytes);
  new Uint8Array(result.value).fill(0);
  assert.deepEqual(Buffer.from(await disk.download(path,hash(bytes))),bytes,'caller mutation cannot corrupt the queued verified copy');
  assert.equal(calls,1,'a second reader must not refetch while the cache write is queued');
  assert.equal(storage.stores.get('nodo-housing-files-v1').size,0);
 }finally{hold.release();await drain();}
 assert.equal(storage.stores.get('nodo-housing-files-v1').size,1);
});

test('a blocked store bounds queued bytes and entries without delaying uncached downloads',async()=>{
 const hold=gate(),files=new Map(Array.from({length:3},(_,i)=>['data/cache/'+i+'.bin',Buffer.alloc(4,i)]));let calls=0;
 const storage=backend({beforePut:async()=>{hold.start();await hold.waiting;}});
 const {api}=runtime(async url=>{calls++;return new Response(files.get(url.slice(1).split('?')[0]));},storage),disk=api.create('blocked',2,{maxBytes:8});
 try{
  for(const[p,bytes]of files)assert.deepEqual(Buffer.from(await disk.download(p,hash(bytes))),bytes);
  await hold.started;assert.equal(storage.stats.puts,1,'only the first queued write can start');
  const first=[...files][0],last=[...files][2];
  await disk.download(first[0],hash(first[1]));assert.equal(calls,3,'an admitted queued file is reusable');
  await disk.download(last[0],hash(last[1]));assert.equal(calls,4,'the third file is not retained beyond the queue budget');
 }finally{hold.release();await drain();}
 assert.equal(storage.stats.puts,2);assert.equal(storage.stores.get('blocked').size,2);
});

test('persistent writes read sizes only for unseen keys, including entries from another context',async()=>{
 const storage=backend({requestKeys:true}),files=new Map(Array.from({length:20},(_,i)=>['data/cache/'+i+'.bin',Buffer.alloc(4,i)]));
 const {api}=runtime(async url=>new Response(files.get(url.slice(1).split('?')[0])),storage),disk=api.create('sizes',32,{maxBytes:128});
 for(const[p,bytes]of files){await disk.download(p,hash(bytes));await drain();}
 assert.equal(storage.stats.matches,20,'initial lookups are needed, but known retained entries need no size reread');
 storage.stores.get('sizes').set('/data/cache/external.bin?v=other-context',new Response('outside',{headers:{'Content-Length':'7'}}));
 files.set('data/cache/next.bin',Buffer.from('next'));
 const before=storage.stats.matches;await disk.download('data/cache/next.bin',hash(files.get('data/cache/next.bin')));await drain();
 assert.equal(storage.stats.matches-before,2,'only the new download lookup and the unseen external entry are read');
});

test('persistence failures do not reject verified bytes or leave rejected queue work unhandled',async()=>{
 const bytes=Buffer.from('quota-independent');let calls=0;
 const storage=backend({beforePut:async()=>{throw Error('Cache quota unavailable');}});
 const {api}=runtime(async()=>{calls++;return new Response(bytes);},storage),disk=api.createHousing();
 assert.deepEqual(Buffer.from(await disk.download(path,hash(bytes))),bytes);await drain();
 assert.deepEqual(Buffer.from(await disk.download(path,hash(bytes))),bytes);await drain();
 assert.equal(calls,2);assert.equal(storage.stores.get('nodo-housing-files-v1').size,0);
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
