import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {publicAsset,runtime,injection} from './build-cloudflare-assets.mjs';
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
