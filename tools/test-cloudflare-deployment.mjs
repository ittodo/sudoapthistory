import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verify} from './verify-cloudflare-deployment.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
test('public verification binds health, release, manifest and sample bytes to SHA',async()=>{
  const sha='a'.repeat(40), content='fixture';
  const files=['index.html','data/index.json','data/earnings_index.json','deployment-version.js'].map(path=>({path,sha256:hash(content),bytes:content.length}));
  const manifest=JSON.stringify({schema:1,gitSha:sha,files});
  const release={gitSha:sha,assetManifestSha256:hash(manifest)};
  const original=globalThis.fetch;let badHealth=false,badBytes=false,missing404=true;
  globalThis.fetch=async(input)=>{
    const url=new URL(input);let body=content,status=200;
    if(url.pathname==='/deployment.json')body=JSON.stringify(release);
    else if(url.pathname==='/api/health')body=JSON.stringify({gitSha:badHealth?'b'.repeat(40):sha,status:'ok',workerVersionId:'fixture-worker-version',schemaVersion:1});
    else if(url.pathname==='/deployment-manifest.json')body=manifest;
    else if(url.pathname.startsWith('/data/__migration_missing_'))status=missing404?404:200;
    else if(badBytes)body='stale';
    const response=new Response(body,{status});Object.defineProperty(response,'url',{value:url.href});return response;
  };
  try {
    assert.deepEqual(await verify('https://fixture.invalid',sha),{...release,workerVersionId:'fixture-worker-version',schemaVersion:1});
    badHealth=true;await assert.rejects(verify('https://fixture.invalid',sha),/SHA mismatch/);badHealth=false;
    badBytes=true;await assert.rejects(verify('https://fixture.invalid',sha),/Public hash mismatch/);badBytes=false;
    missing404=false;await assert.rejects(verify('https://fixture.invalid',sha),/must be 404/);
  } finally {globalThis.fetch=original;}
});
