import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, toNamespacedPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { inspectLayout, forbiddenReason } from './verify-site-layout.mjs';
const root = mkdtempSync(join(tmpdir(), 'site-layout-'));
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
const put = (name, data = '{}') => { mkdirSync(join(root, name, '..'), { recursive: true }); writeFileSync(join(root, name), data); };
const script = fileURLToPath(new URL('./verify-site-layout.mjs', import.meta.url));
const repository = dirname(dirname(script));
const invocations = [{name: 'ordinary absolute path', script, cwd: repository}];
if (process.platform === 'win32') invocations.push(
  {name: 'extended absolute path', script: toNamespacedPath(script), cwd: repository},
  {name: 'relative path from extended cwd', script: relative(repository, script), cwd: toNamespacedPath(repository)}
);
const verifyCli = (expectedStatus, expectedViolations) => {
  for (const invocation of invocations) {
    const output = spawnSync(process.execPath, [invocation.script, '--root', root, '--json'], {cwd: invocation.cwd, encoding: 'utf8'});
    assert.ifError(output.error); assert.equal(output.status, expectedStatus, invocation.name + ': ' + output.stderr);
    assert.ok(output.stdout.trim(), invocation.name + ': CLI must emit the actual layout report');
    const report = JSON.parse(output.stdout);
    assert.equal(report.mode, 'worktree'); assert.equal(report.auditOnly, false);
    assert.equal(report.violations.length, expectedViolations);
    assert.ok(report.files.some(file => file.path === 'data/earnings/005930.json'));
    if (expectedViolations) assert.ok(report.violations.some(file => file.path === 'data/div/005930.json'));
  }
};
try {
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  put('data/earnings/005930.json'); put('data/tx/서울 종로.json');
  git('add', '.'); git('commit', '-m', 'base');
  const first = inspectLayout({ root });
  assert.equal(first.count, 2); assert.equal(first.violations.length, 0); assert.equal(first.duplicateFiles, 1);
  assert.equal(inspectLayout({ root }).manifestSha256, first.manifestSha256);
  assert.equal(inspectLayout({ root, ref: 'HEAD' }).count, 2);
  assert.equal(inspectLayout({ root, staged: true }).bytes, 4);
  verifyCli(0, 0);
  put('.gitignore', 'data/div/\n'); put('data/div/005930.json');
  assert.equal(inspectLayout({ root }).violations[0].path, 'data/div/005930.json');
  assert.equal(inspectLayout({ source: root }).violations.length, 1);
  assert.equal(forbiddenReason('data/earnings/earnings/1.json'), 'nested-earnings');
  assert.equal(forbiddenReason('data/index.json.bak'), 'temporary-output');
  verifyCli(1, 1);
  assert.equal(spawnSync(process.execPath, [script, '--root', root, '--allow-existing-legacy']).status, 0);
  git('add', '-f', 'data/div/005930.json');
  assert.equal(inspectLayout({ root, staged: true }).violations.length, 1);
  put('data/.company-export.json');
  assert.ok(inspectLayout({ root }).violations.some(f => f.reason === 'producer-completion-record'));
  assert.ok(!inspectLayout({ source: root }).files.some(f => f.path === 'data/.company-export.json'));
  unlinkSync(join(root, 'data/.company-export.json'));
  put('.gitignore', 'data/div/\ndata/*.bak\n'); put('data/index.json.bak');
  assert.equal(inspectLayout({ root }).violations.length, 2);
  const link = join(root, 'data/link');
  symlinkSync(join(root, 'data/earnings'), link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => inspectLayout({ source: root }), /Symlink|Non-regular/);
  unlinkSync(link);
  console.log('Site layout modes, Windows extended CLI paths, ignored retired outputs, Korean paths and audit tests passed');
} finally { rmSync(root, { recursive: true, force: true }); }
