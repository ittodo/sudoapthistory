import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureKey} from './ensure-cloudflare-withdrawal-key.mjs';
const env={GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/cloudflare-staging',CLOUDFLARE_ACCOUNT_ID:'90ef0cc5b9fc89e9005b5ca905ae2b6e',CLOUDFLARE_API_TOKEN:'fake'};
test('staging key setup refuses other targets and never overwrites existing key',async()=>{
 await assert.rejects(ensureKey({...env,GITHUB_REF:'refs/heads/main'},()=>{throw Error('network must not run')}));
 const calls=[];
 assert.equal(await ensureKey(env,async(url,options)=>{calls.push(options.method);return Response.json({success:true,result:[{name:'WITHDRAWAL_ENCRYPTION_KEY',type:'secret_text'}]})}),'existing');assert.deepEqual(calls,['GET']);
});
test('new key is 256-bit and only sent to pinned staging secret endpoint',async()=>{
 let count=0;
 assert.equal(await ensureKey(env,async(url,options)=>{
  assert.ok(url.endsWith('/workers/scripts/nodostream-staging/secrets'));count++;
  if(options.method==='PUT'){const b=JSON.parse(options.body);assert.equal(b.name,'WITHDRAWAL_ENCRYPTION_KEY');assert.match(b.text,/^[a-f0-9]{64}$/);}
  return Response.json({success:true,result:options.method==='GET'?[]:{name:'WITHDRAWAL_ENCRYPTION_KEY',type:'secret_text'}});
 }),'created');assert.equal(count,2);
});
