import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function verifyStaging(config, env) {
  assert.equal(env.CLOUDFLARE_STAGING_ENABLED, 'true', 'Staging must be explicitly enabled');
  assert.equal(env.GITHUB_REF, 'refs/heads/cloudflare-staging', 'Only the staging branch may deploy');
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID, '90ef0cc5b9fc89e9005b5ca905ae2b6e', 'Unexpected account');
  const origin = 'https://nodostream-staging.sksk17.workers.dev';
  assert.equal(env.CLOUDFLARE_STAGING_ORIGIN, origin, 'Unexpected verification origin');
  assert.equal(config.name, 'nodostream-staging');
  assert.equal(config.workers_dev, true);
  assert.equal(config.routes?.length ?? 0, 0, 'Staging must not bind production domains');
  assert.equal(config.route, undefined);
  assert.equal(config.limits?.cpu_ms, undefined, 'Use the free plan CPU limit');
  assert.equal(config.vars.SITE_ORIGIN, origin);
  assert.equal(config.vars.AUTH_ENABLED, 'false', 'Google setup requires a separate review');
  assert.equal(config.vars.MAINTENANCE, 'true');
  assert.deepEqual(config.d1_databases, [{
    binding: 'DB', database_name: 'nodostream-staging',
    database_id: '636d41b6-3ed7-4f6d-8f0b-823324c4ccad',
    migrations_dir: 'cloudflare/migrations'
  }], 'Only the approved staging DB may be migrated');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyStaging(JSON.parse(readFileSync('wrangler.jsonc', 'utf8')), process.env);
  console.log('Staging target verified; production domains and DB are excluded.');
}
