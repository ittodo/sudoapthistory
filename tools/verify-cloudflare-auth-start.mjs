import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Start only; do not follow Google redirects, sign in, or log OAuth secrets.
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
    const response=await fetch(origin+'/auth/google?returnTo=%2Faccount%2F',{redirect:'manual',signal:AbortSignal.timeout(30000)});
    validateAuthStart(response,origin,config.vars.GOOGLE_CLIENT_ID);
    console.log('Staging Google login start verified. Interactive login and token exchange remain to be tested.');
  }catch {console.error('Staging Google login start failed; check client configuration, secret and redirect settings.');process.exitCode=1;}
}
