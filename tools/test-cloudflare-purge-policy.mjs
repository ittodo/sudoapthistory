import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildPurgePolicy } from './cloudflare-purge-policy.mjs';

const policy = buildPurgePolicy(['data/parcels.json']);
assert.ok(policy.urls.includes('https://nodostream.com/data/parcels.json'));
assert.ok(policy.urls.includes('https://nodostream.com/'));
assert.ok(policy.urls.includes('https://nodostream.com/compare/'));
assert.ok(policy.urls.includes('https://nodostream.com/map/'));
const mapPolicy = buildPurgePolicy(['data/map/index.json', 'js/map-app.js']);
assert.ok(mapPolicy.urls.includes('https://nodostream.com/map/'));
assert.ok(mapPolicy.urls.includes('https://nodostream.com/map/index.html'));
const script = resolve('tools/cloudflare-purge-policy.mjs');
const root = mkdtempSync(join(tmpdir(), 'purge-test-'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
try {
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'index.html'), '<script>window.APT_ASSET_VERSION="v1"</script>');
  git('add', '.'); git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'data/parcels.json'), '{}');
  git('add', '.'); git('commit', '-m', 'parcels');
  writeFileSync(join(root, 'data/prices.json'), '{}');
  git('add', '.'); git('commit', '-m', 'prices');
  const head = git('rev-parse', 'HEAD');
  const result = JSON.parse(execFileSync(process.execPath, [script, '--json'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PURGE_BASE_SHA: base, PURGE_HEAD_SHA: head },
  }));
  assert.deepEqual(result.changed, ['data/parcels.json', 'data/prices.json']);
  assert.ok(result.urls.includes('https://nodostream.com/data/parcels.json?v=v1'));
  writeFileSync(join(root, 'data/서울 종로.json'), '{}');
  git('add', '.'); git('commit', '-m', 'Korean filename');
  const korean = JSON.parse(execFileSync(process.execPath, [script, '--json'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PURGE_BASE_SHA: head, PURGE_HEAD_SHA: 'HEAD' },
  }));
  assert.deepEqual(korean.changed, ['data/서울 종로.json']);
  assert.ok(korean.urls.includes('https://nodostream.com/data/%EC%84%9C%EC%9A%B8%20%EC%A2%85%EB%A1%9C.json'));
  assert.throws(() => execFileSync(process.execPath, [script, '--json'], {
    cwd: root, stdio: 'pipe', env: { ...process.env, PURGE_BASE_SHA: 'bad-ref' },
  }));
  console.log('Cloudflare parcel, versioned URL, multi-commit and bad-ref checks passed');
} finally {
  // Only the freshly created temporary fixture is removed.
  rmSync(root, { recursive: true, force: true });
}
