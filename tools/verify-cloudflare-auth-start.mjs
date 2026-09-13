import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Start only; do not follow Google redirects, sign in, or log OAuth secrets.
export async function startWithAgeConfirmation(request,origin,path='/auth/google?returnTo=%2Faccount%2F'){
  const gate=await request(origin+path,{redirect:'manual',signal:AbortSignal.timeout(30000)});
  assert.equal(gate.status,200,'Age confirmation must precede Google login');
  assert.equal(gate.headers.get('Cache-Control'),'no-store');
  assert.equal(gate.headers.get('Referrer-Policy'),'same-origin','Native form submission must retain same-origin Origin');
  const formAction=gate.headers.get('Content-Security-Policy')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('form-action '));
  assert.equal(formAction,"form-action 'self' https://accounts.google.com",'Browser must permit Google redirects after form submission');
  const html=await gate.text();assert.match(html,/name="age14" value="yes" required/);
  const csrf=html.match(/name="csrf" value="([a-f0-9]{64})"/)?.[1];assert.ok(csrf);
  const cookie=gate.headers.get('Set-Cookie')?.match(/__Host-nodo_age=[^;]+/)?.[0];assert.ok(cookie);
  return request(origin+path,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,age14:'yes'}).toString()});
}
export function validateAuthStart(response,origin,clientId) {
  assert.equal(response.status,302,'Google login must be configured and enabled');
  const destination=new URL(response.headers.get('Location'));
  assert.equal(destination.origin,'https://accounts.google.com');
  assert.equal(destination.pathname,'/o/oauth2/v2/auth');
  for(const [key,value] of Object.entries({client_id:clientId,redirect_uri:origin+'/auth/callback',
    response_type:'code',scope:'openid email profile',code_challenge_method:'S256'})) {
    assert.equal(destination.searchParams.get(key),value,`Unexpected OAuth parameter: ${key}`);
  }
  for(const key of ['state','nonce','code_challenge']) assert.ok(destination.searchParams.get(key)?.length>=32,`Missing OAuth protection: ${key}`);
  const cookie=response.headers.get('Set-Cookie')||'';
  assert.ok(cookie.includes('__Host-nodo_oauth='+destination.searchParams.get('state')),'OAuth cookie must match state');
  for(const flag of ['HttpOnly','Secure','SameSite=Lax','Path=/']) assert.ok(cookie.includes(flag),`Missing cookie flag: ${flag}`);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {
    const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
    assert.equal(config.name,'nodostream-staging');
    const origin=config.vars.SITE_ORIGIN;
    assert.equal(origin,'https://nodostream-staging.sksk17.workers.dev');
    const response=await startWithAgeConfirmation(fetch,origin);
    validateAuthStart(response,origin,config.vars.GOOGLE_CLIENT_ID);
    console.log('Staging Google login start verified. Interactive login and token exchange remain to be tested.');
  }catch {console.error('Staging Google login start failed; check client configuration, secret and redirect settings.');process.exitCode=1;}
}
