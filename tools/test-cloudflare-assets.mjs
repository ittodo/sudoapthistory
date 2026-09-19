import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,truncateSync,statSync,utimesSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {publicAsset,runtime,injection,build,sha256} from './build-cloudflare-assets.mjs';
test('one-file-at-a-time packaging preserves bytes and manifest hashes and rejects oversized assets',()=>{
 const root=mkdtempSync(join(tmpdir(),'nodo-assets-stream-'));
 try {
  execFileSync('git',['init'],{cwd:root,stdio:'pipe'});
  writeFileSync(join(root,'.gitignore'),'cloudflare/dist/\n');
  writeFileSync(join(root,'index.html'),'<html><head></head><body>한글</body></html>');
  mkdirSync(join(root,'data'));
  writeFileSync(join(root,'data/valid.json'),'{}');
  const output=join(root,'cloudflare/dist/public');
  build(root,output,'a'.repeat(40));
  const manifest=JSON.parse(readFileSync(join(output,'deployment-manifest.json')));
  for(const file of manifest.files) {
   const bytes=readFileSync(join(output,file.path));
   assert.equal(sha256(bytes),file.sha256);assert.equal(bytes.length,file.bytes);
  }
  assert.equal(readFileSync(join(output,'index.html'),'utf8'),'<html><head>'+injection+'</head><body>한글</body></html>');
  const unchanged=join(output,'data/valid.json');utimesSync(unchanged,1000,1000);
  const before=statSync(unchanged).mtimeMs;
  const repeated=build(root,output,'a'.repeat(40));assert.equal(repeated.written,0);assert.ok(repeated.reused>0);assert.equal(statSync(unchanged).mtimeMs,before);
  build(root,output,'b'.repeat(40));assert.equal(statSync(unchanged).mtimeMs,before,'new release SHA does not rewrite old data');
  writeFileSync(join(output,'stale.json'),'stale');writeFileSync(unchanged,'damaged');
  build(root,output,'b'.repeat(40));assert.equal(readFileSync(unchanged,'utf8'),'{}');assert.equal(existsSync(join(output,'stale.json')),false);
  truncateSync(join(root,'data/valid.json'),25*1024*1024+1);
  assert.throws(()=>build(root,output,'a'.repeat(40)),/exceeds 25 MiB/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('allowlist preserves public assets but excludes internal files',()=>{
  for(const p of ['apartment/index.html','board/index.html','data/apartments/00.json','data/earnings/000020.json','data/tx/고양시 덕양구.json','data/polygen/index.packed.bin','index.html','js/main-app.js','policy.html'])assert.equal(publicAsset(p),true,p);
  for(const p of ['docs/secret.html','supabase/schema.sql','.env','data/private.db','data/foo.json.bak','tools/tool.js','cloudflare/src/index.js','data/div/a.json','data/.company-export.json','data/credentials.json','data/logs/a.json'])assert.equal(publicAsset(p),false,p);
});
test('unapproved privacy drafts stay out of public assets and do not load external resources',()=>{
  for(const path of ['docs/privacy-preview.html','docs/privacy-policy-draft.md','docs/google-production-branding-checklist.md'])assert.equal(publicAsset(path),false,path);
  const html=readFileSync(new URL('../docs/privacy-preview.html',import.meta.url),'utf8');
  assert.match(html,/noindex,nofollow/);
  assert.match(html,/아직 시행되지 않았습니다/);
  assert.doesNotMatch(html,/<(?:script|iframe|img|link)\b/i);
});
test('runtime versions only same-origin data GETs, preserving init',async()=>{
  const calls=[];const context={URL,Request,location:{href:'https://nodostream.com/map/',origin:'https://nodostream.com'},window:{fetch:(...args)=>calls.push(args)}};
  vm.runInNewContext(runtime('a'.repeat(40)),context);
  const init={headers:{test:'yes'}};
  await context.window.fetch('/data/index.json',init);
  assert.equal(new URL(calls[0][0]).searchParams.get('v'),'a'.repeat(40));assert.equal(calls[0][1],init);
  await context.window.fetch('/api/session');assert.equal(calls[1][0],'/api/session');
  await context.window.fetch('https://elsewhere.test/data/a.json');assert.equal(calls[2][0],'https://elsewhere.test/data/a.json');
  await context.window.fetch('/data/a.json',{method:'POST'});assert.equal(calls[3][0],'/data/a.json');
  const request=new Request('https://nodostream.com/data/a.json?old=1',{headers:{'X-Test':'kept'},credentials:'same-origin'});
  await context.window.fetch(request);
  assert.equal(calls[4][0].headers.get('X-Test'),'kept');assert.equal(calls[4][0].credentials,'same-origin');
  assert.equal(new URL(calls[4][0].url).searchParams.get('old'),'1');assert.equal(new URL(request.url).searchParams.has('v'),false);
  assert.equal(injection,'<script src="/deployment-version.js"></script>');
});
