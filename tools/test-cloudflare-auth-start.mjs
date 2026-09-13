import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAuthStart,startWithAgeConfirmation} from './verify-cloudflare-auth-start.mjs';

test('login smoke explicitly submits the age confirmation and rejects a missing gate',async()=>{
 const origin='https://fixture.invalid',csrf='a'.repeat(64);let calls=0;
 const response=await startWithAgeConfirmation(async(url,options)=>{
  calls++;assert.equal(new URL(url).origin,origin);
  if(calls===1)return new Response(`<input name="csrf" value="${csrf}"><input type="checkbox" name="age14" value="yes" required>`,{headers:{'Cache-Control':'no-store','Referrer-Policy':'same-origin','Set-Cookie':'__Host-nodo_age=fixture; Secure; HttpOnly; Path=/'}});
  assert.equal(options.method,'POST');assert.equal(options.headers.Origin,origin);
  assert.equal(options.headers.Cookie,'__Host-nodo_age=fixture');
  assert.equal(new URLSearchParams(options.body).get('age14'),'yes');
  assert.equal(new URLSearchParams(options.body).get('csrf'),csrf);
  return new Response(null,{status:302});
 },origin);
 assert.equal(calls,2);assert.equal(response.status,302);
 await assert.rejects(startWithAgeConfirmation(async()=>new Response(null,{status:302}),origin));
 await assert.rejects(startWithAgeConfirmation(async()=>new Response('',{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}}),origin));
});

test('login smoke test checks client, callback, cookie and PKCE without following redirects',()=>{
  const origin='https://fixture.invalid',client='fixture-client',state='s'.repeat(43);
  const destination=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  destination.search=new URLSearchParams({client_id:client,redirect_uri:origin+'/auth/callback',
    response_type:'code',scope:'openid email profile',code_challenge_method:'S256',state,nonce:'n'.repeat(43),code_challenge:'c'.repeat(43)});
  const make=()=>new Response(null,{status:302,headers:{Location:destination.href,
    'Set-Cookie':`__Host-nodo_oauth=${state}; HttpOnly; Secure; SameSite=Lax; Path=/`,'Cache-Control':'no-store'}});
  validateAuthStart(make(),origin,client);
  for(const mutate of [r=>r.headers.set('Location','https://evil.invalid/'),
    r=>r.headers.set('Set-Cookie','__Host-nodo_oauth=wrong'),r=>r.headers.delete('Cache-Control')]) {
    const response=make();mutate(response);assert.throws(()=>validateAuthStart(response,origin,client));
  }
  assert.throws(()=>validateAuthStart(make(),origin,'wrong-client'));
  assert.throws(()=>validateAuthStart(make(),'https://wrong.invalid',client));
  assert.throws(()=>validateAuthStart(new Response(null,{status:503}),origin,client));
});
