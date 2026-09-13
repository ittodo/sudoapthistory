import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// This gate validates operator-approved configuration; it does not inspect billing or grant permissions.
export function verifyProduction(config, contract, env) {
  assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Only main may deploy production');
  assert.equal(env.CLOUDFLARE_PRODUCTION_ENABLED, 'true', 'Production approval is required');
  assert.equal(env.NODESTREAM_DEPLOYMENT_PROVIDER, 'cloudflare');
  assert.equal(contract.schema, 1);
  assert.equal(contract.provider, 'cloudflare');
  assert.equal(contract.productionOrigin, 'https://nodostream.com');
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID, '90ef0cc5b9fc89e9005b5ca905ae2b6e');
  const prod = config.env?.production;
  assert.equal(prod?.name, 'nodostream');
  assert.equal(prod.workers_dev, false);
  assert.equal(prod.preview_urls, false, 'Production preview URLs must stay disabled');
  assert.equal(prod.vars?.SITE_ORIGIN, 'https://nodostream.com');
  for (const key of ['AUTH_ENABLED', 'MAINTENANCE']) assert.ok(['true','false'].includes(prod.vars[key]));
  if (prod.vars.AUTH_ENABLED === 'true') {
    assert.equal(env.CLOUDFLARE_PRODUCTION_AUTH_APPROVED, 'true');
    assert.equal(prod.vars.GOOGLE_CLIENT_ID, '221788330191-fs4kij4ft29g9bq93qmg3kh6sbjiclr4.apps.googleusercontent.com');
  }
  if (prod.vars.MAINTENANCE === 'false') {
    assert.equal(env.CLOUDFLARE_PRODUCTION_WRITES_APPROVED, 'true');
    assert.equal(prod.vars.AUTH_ENABLED, 'true');
  }
  const id = env.CLOUDFLARE_PRODUCTION_D1_ID;
  assert.match(id || '', /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i, 'Approved production DB ID is required');
  assert.notEqual(id, '00000000-0000-0000-0000-000000000000');
  assert.notEqual(id.toLowerCase(), '636d41b6-3ed7-4f6d-8f0b-823324c4ccad');
  assert.deepEqual(prod.d1_databases, [{binding:'DB', database_name:'nodostream-production', database_id:id, migrations_dir:'cloudflare/migrations'}]);
  assert.equal(prod.route, undefined);
  assert.equal(config.route, undefined);
  assert.equal(config.routes?.length ?? 0, 0);
  for (const route of prod.routes || []) assert.deepEqual(route, {pattern:'nodostream.com', custom_domain:true});
  assert.ok(['free','paid'].includes(env.CLOUDFLARE_WORKERS_PLAN), 'Explicit plan decision required');
  if (env.CLOUDFLARE_WORKERS_PLAN === 'free') assert.equal(prod.limits?.cpu_ms, undefined, 'Free plan uses its default CPU limit');
  else {
    assert.equal(env.CLOUDFLARE_PAID_APPROVED, 'true', 'Paid plan needs separate approval');
    assert.equal(prod.limits?.cpu_ms, 50);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyProduction(JSON.parse(readFileSync('wrangler.jsonc','utf8')), JSON.parse(readFileSync('tools/deployment-provider.json','utf8')), process.env);
  console.log('Production configuration gate passed; no DB migration, DNS or billing changes performed.');
}
