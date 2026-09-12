import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verify,verifyWithRetry} from './verify-cloudflare-deployment.mjs';
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

test('deployment propagation retries are bounded and never hide persistent failures',async()=>{
  let calls=0,sleeps=0;const messages=[];
  const options={attempts:3,intervalMs:0,sleep:async()=>{sleeps++;},onRetry:m=>messages.push(m)};
  const result={gitSha:'a'.repeat(40)};
  assert.deepEqual(await verifyWithRetry('https://fixture.invalid',result.gitSha,undefined,{
    ...options,check:async()=>{if(++calls<3)throw new Error('Public check failed: 404 /deployment.json');return result;}
  }),result);
  assert.equal(calls,3);assert.equal(sleeps,2);assert.equal(messages.length,2);
  for(const message of ['Public check failed: 404 /deployment.json','Deployment/health SHA mismatch','Manifest hash mismatch','Missing JSON must be 404']) {
    calls=0;
    await assert.rejects(verifyWithRetry('https://fixture.invalid',result.gitSha,undefined,{
      ...options,check:async()=>{calls++;throw new Error(message);}
    }),error=>error.message===message);
    assert.equal(calls,3);
  }
});

test('verification deadline aborts an in-flight request',async()=>{
  await assert.rejects(verifyWithRetry('https://fixture.invalid','a'.repeat(40),undefined,{
    timeoutMs:10,onRetry:()=>{},
    check:async(_origin,_sha,_manifest,{signal})=>{
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(resolve,1000);
        signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});
      });
    }
  }),{name:'TimeoutError'});
});
