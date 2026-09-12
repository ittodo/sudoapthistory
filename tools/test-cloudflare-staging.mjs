import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyStaging} from './verify-cloudflare-staging.mjs';

test('staging guard rejects production, disabled and misconfigured targets', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const env = {
    GITHUB_REF: 'refs/heads/cloudflare-staging', CLOUDFLARE_STAGING_ENABLED: 'true',
    CLOUDFLARE_ACCOUNT_ID: '90ef0cc5b9fc89e9005b5ca905ae2b6e',
    CLOUDFLARE_STAGING_ORIGIN: 'https://nodostream-staging.sksk17.workers.dev'
  };
  verifyStaging(config, env);
  const disabled=structuredClone(config);disabled.vars.AUTH_ENABLED='false';
  verifyStaging(disabled,env);
  const paused=structuredClone(config);paused.vars.MAINTENANCE='true';
  verifyStaging(paused,env);
  assert.equal(config.vars.MAINTENANCE,'false');
  assert.equal(config.env.production.vars.AUTH_ENABLED,'false');
  for (const change of [
    {GITHUB_REF: 'refs/heads/main'}, {CLOUDFLARE_STAGING_ENABLED: ''},
    {CLOUDFLARE_ACCOUNT_ID: 'other'}, {CLOUDFLARE_STAGING_ORIGIN: 'https://nodostream.com'}
  ]) assert.throws(() => verifyStaging(config, {...env, ...change}));
  for (const mutate of [
    c => c.d1_databases[0].database_id = 'production',
    c => c.d1_databases.push({...c.d1_databases[0]}),
    c => c.routes = ['nodostream.com/*'], c => c.route = 'nodostream.com/*',
    c => c.vars.AUTH_ENABLED = 'invalid', c => c.vars.MAINTENANCE = 'invalid',
    c => delete c.vars.MAINTENANCE,
    c => c.env.production.vars.MAINTENANCE = 'false',
    c => c.env.production.vars.AUTH_ENABLED = 'true',
    c => c.vars.GOOGLE_CLIENT_ID = 'other-client', c => delete c.vars.GOOGLE_CLIENT_ID,
    c => c.limits = {cpu_ms: 50}, c => c.vars.SITE_ORIGIN = 'https://nodostream.com',
    c => c.name = 'nodostream'
  ]) {
    const changed = structuredClone(config); mutate(changed);
    assert.throws(() => verifyStaging(changed, env));
  }
});
