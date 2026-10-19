import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createCurrentReviewPreview,startCurrentReviewPreview} from './preview-current-review.mjs';

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'current-review-preview-')),baseline=join(root,'site'),candidate=join(root,'_ops','candidate');
  const put=(directory,name,value)=>{const file=join(directory,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,value);};
  put(candidate,'manifest.json',JSON.stringify({candidateOnly:true,privateEvidence:'internal'}));
  put(candidate,'data/index.json','{"from":"candidate"}');
  put(candidate,'data/map/index.json','{"map":"candidate"}');
  put(candidate,'data/map/boundaries/용인수지구.json','{"pub-one":{"type":"FeatureCollection","features":[]}}');
  put(baseline,'data/map/boundaries/용인수지구.json','old boundary');
  put(baseline,'data/map/boundaries/성남분당구.json','stale missing candidate boundary');
  put(candidate,'data/apartments/ab.json','{"detail":"candidate"}');
  put(candidate,'data/housing-v3/index.json','{"metadata":"candidate"}');
  put(candidate,'index.html','candidate must not replace UI');
  put(candidate,'js/map-app.js','candidate must not replace JS');
  put(candidate,'evidence/targets.json','private evidence');
  put(candidate,'data/evidence/targets.json','nested private evidence');
  put(candidate,'data/private/targets.json','nested private data');
  put(candidate,'data/manifest.json','private manifest');
  put(baseline,'index.html','<!doctype html><html><head><title>Current source</title></head><body><main>한글</main></body></html>');
  put(baseline,'map/index.html','<!doctype html><html><head></head><body>map source</body></html>');
  put(baseline,'apartment/index.html','<!doctype html><html><head></head><body>detail source</body></html>');
  put(baseline,'screener.html','<html><head></head><body>screen</body></html>');
  put(baseline,'js/map-app.js','current map script');
  put(baseline,'css/site.css','body{color:green}');
  put(baseline,'data/index.json','{"from":"baseline"}');
  put(baseline,'data/daily/region.bin',Buffer.from([0,1,2,255]));
  put(baseline,'data/apartments/cd.json','{"detail":"fallback"}');
  put(baseline,'data/search/apartments.json','old root search');
  put(baseline,'cloudflare/dist/public/data/search/apartments.json','old packaged search');
  put(baseline,'cloudflare/dist/public/data/map/price-cache/index.json','old map cache');
  put(baseline,'cloudflare/dist/public/js/apartment-search-worker.bundle.js','existing generated worker');
  put(baseline,'tools/private.js','internal tool');
  put(baseline,'.env','private environment');
  return {root,baseline,candidate,put,close:()=>rmSync(root,{recursive:true,force:true})};
}
function get(server,path,method='GET',headers={}){
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:server.address().port,path,method,headers},res=>{
      const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks),text:Buffer.concat(chunks).toString()}));
    });req.on('error',reject);req.end();
  });
}
const close=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));

test('candidate data overlays current source UI without copying or changing baseline files',async()=>{
  const f=fixture(),server=await startCurrentReviewPreview({...f,port:0});try{
    assert.equal(server.address().address,'127.0.0.1');
    for(const path of ['data/index.json','data/map/index.json','data/map/boundaries/용인수지구.json','data/apartments/ab.json','data/housing-v3/index.json']){
      const r=await get(server,encodeURI('/'+path)+'?v=candidate');assert.equal(r.status,200);assert.equal(r.text,readFileSync(join(f.candidate,path),'utf8'));
    }
    const html=await get(server,'/');assert.equal(html.status,200);assert.match(html.text,/Current source/);
    assert.match(html.text,/현재 리뷰 데이터 미리보기 · 운영 미반영/);assert.match(html.text,/id="current-review-preview"/);
    assert.doesNotMatch(html.text,/candidate must not/);assert.equal(html.headers['cache-control'],'no-store');
    assert.equal(html.headers['x-robots-tag'],'noindex, nofollow');assert.equal(html.headers['set-cookie'],undefined);
    assert.equal((await get(server,'/js/map-app.js')).text,'current map script');
    assert.equal((await get(server,'/data/apartments/cd.json')).text,'{"detail":"fallback"}');
    assert.deepEqual((await get(server,'/data/daily/region.bin')).bytes,Buffer.from([0,1,2,255]));
    const head=await get(server,'/','HEAD');assert.equal(head.status,200);assert.equal(head.bytes.length,0);
    assert.equal(Number(head.headers['content-length']),html.bytes.length);
    const redirect=await get(server,'/map?item=A');assert.equal(redirect.status,308);assert.equal(redirect.headers.location,'/map/?item=A');
    assert.match((await get(server,'/map/')).text,/map source/);assert.match((await get(server,'/apartment/')).text,/detail source/);
    assert.match((await get(server,'/screener')).text,/screen/);
    assert.equal(readFileSync(join(f.baseline,'data/index.json'),'utf8'),'{"from":"baseline"}');
    assert.doesNotMatch(readFileSync(join(f.baseline,'index.html'),'utf8'),/current-review-preview/);
  }finally{await close(server);f.close();}
});

test('private paths, traversal, login and writes are unavailable',async()=>{
  const f=fixture(),server=await startCurrentReviewPreview({...f,port:0});try{
    for(const path of ['/manifest.json','/evidence/targets.json','/data/evidence/targets.json','/data/private/targets.json','/data/manifest.json','/.env','/tools/private.js','/api/session','/auth/google','/__preview/login','/cloudflare/dist/public/data/search/apartments.json']){
      const r=await get(server,path);assert.equal(r.status,404,path);assert.doesNotMatch(r.text,/private evidence|internal tool|environment/);
    }
    for(const path of ['/../manifest.json','/%2e%2e/manifest.json','/data/%2e%2e/%2e%2e/manifest.json','/data%5c..%5cmanifest.json','/data/index.json%00','/data/index.json:stream','/data/%252e%252e/index.json','//data/index.json','/data/./index.json','/%E0%A4%A']){
      assert.equal((await get(server,path)).status,400,path);
    }
    for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']){
      const r=await get(server,'/data/index.json',method);assert.equal(r.status,405);assert.equal(r.headers.allow,'GET, HEAD');
    }
    assert.equal((await get(server,'/', 'GET',{Host:'external.example'})).status,403);
    assert.equal((await get(server,'/', 'GET',{Host:'localhost:'+server.address().port})).status,200);
  }finally{await close(server);f.close();}
});

test('only the missing generated worker may use old packaged output; metadata caches require candidate files',async()=>{
  const f=fixture(),server=await startCurrentReviewPreview({...f,port:0});try{
    assert.equal((await get(server,'/js/apartment-search-worker.bundle.js')).text,'existing generated worker');
    for(const path of ['/data/search/apartments.json','/data/map/price-cache/index.json','/data/map/boundaries/성남분당구.json'])assert.equal((await get(server,encodeURI(path))).status,404);
    f.put(f.candidate,'data/search/apartments.json','current search');
    assert.equal((await get(server,'/data/search/apartments.json')).text,'current search');
    f.put(f.baseline,'js/apartment-search-worker.bundle.js','current worker');
    assert.equal((await get(server,'/js/apartment-search-worker.bundle.js')).text,'current worker');
  }finally{await close(server);f.close();}
});

test('candidate marker and isolated _ops path are required at startup',()=>{
  const f=fixture();try{
    assert.throws(()=>createCurrentReviewPreview({baseline:f.baseline}),/explicit candidate/);
    assert.throws(()=>createCurrentReviewPreview({baseline:f.baseline,candidate:f.baseline}),/separate/);
    f.put(f.candidate,'manifest.json','{"candidateOnly":false}');
    assert.throws(()=>createCurrentReviewPreview(f),/candidateOnly/);
    const other=join(f.root,'not-ops');f.put(other,'manifest.json','{"candidateOnly":true}');
    assert.throws(()=>createCurrentReviewPreview({...f,candidate:other}),/inside an _ops/);
  }finally{f.close();}
});

test('asset directory symlinks and linked candidate roots are rejected',async t=>{
  const f=fixture();let server;
  try{
    const outside=join(f.root,'outside');f.put(outside,'entry.json','outside bytes');
    try{symlinkSync(outside,join(f.candidate,'data','linked'),process.platform==='win32'?'junction':'dir');}
    catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('This environment does not permit fixture symlinks');return;}throw error;}
    symlinkSync(outside,join(f.baseline,'data','linked'),process.platform==='win32'?'junction':'dir');
    const linked=join(f.root,'_ops','linked-root');symlinkSync(f.candidate,linked,process.platform==='win32'?'junction':'dir');
    assert.throws(()=>createCurrentReviewPreview({...f,candidate:linked}),/symbolic link or junction/);
    server=await startCurrentReviewPreview({...f,port:0});
    const r=await get(server,'/data/linked/entry.json');assert.equal(r.status,404);assert.doesNotMatch(r.text,/outside bytes/);
  }finally{if(server)await close(server);f.close();}
});
