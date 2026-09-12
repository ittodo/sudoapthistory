import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function forbiddenReason(name) {
  if (/^(data\/div|div\/data)(\/|$)/i.test(name)) return 'retired-output';
  if (/(^|\/)earnings\/earnings(\/|$)/i.test(name)) return 'nested-earnings';
  if (/^(data|div)\//i.test(name) && /(?:\.bak|\.tmp|\.part|~)$/i.test(name)) return 'temporary-output';
  return null;
}

function walk(root, dir = root) {
  const result = [];
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '__pycache__'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(root, path));
    else result.push(relative(root, path).replaceAll('\\', '/'));
  }
  return result;
}

export function inspectLayout({ root = process.cwd(), source, staged = false, ref } = {}) {
  root = resolve(source || root);
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  let files;
  if (staged || ref) {
    const records = staged ? git('ls-files', '--stage', '-z') : git('ls-tree', '-r', '-l', '-z', ref);
    files = records.split('\0').filter(Boolean).map(record => {
      const tab = record.indexOf('\t');
      const fields = record.slice(0, tab).trim().split(/\s+/);
      if (staged && fields[2] !== '0') throw new Error('Unmerged Git index');
      return { path: record.slice(tab + 1), mode: fields[0], hash: staged ? fields[1] : fields[2],
        bytes: staged ? null : Number(fields[3]), hashAlgorithm: 'git-blob' };
    });
    if (staged && files.length) {
      const sizes = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'cat-file', '--batch-check=%(objectsize)'],
        { cwd: root, input: files.map(f => f.hash).join('\n') + '\n', encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim().split('\n');
      files.forEach((f, i) => { f.bytes = Number(sizes[i]); });
    }
  } else {
    const paths = source ? walk(root) : [...new Set([
      ...git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean),
      ...walk(root, join(root, 'data')).filter(forbiddenReason), ...walk(root, join(root, 'div/data')),
    ])];
    files = paths.filter(name => existsSync(join(root, name))).map(name => {
      let parent = root;
      for (const part of name.split('/')) {
        parent = join(parent, part);
        if (lstatSync(parent).isSymbolicLink()) throw new Error(`Symlink or junction in site path: ${name}`);
      }
      const path = join(root, name), stat = lstatSync(path);
      if (!stat.isFile()) throw new Error(`Non-regular site artifact: ${name}`);
      return { path: name, bytes: stat.size, hash: createHash('sha256').update(readFileSync(path)).digest('hex'), hashAlgorithm: 'sha256' };
    });
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const violations = files.flatMap(file => {
    const reason = forbiddenReason(file.path) || (file.mode && file.mode !== '100644' && file.mode !== '100755' ? 'non-regular-artifact' : null);
    return reason ? [{ ...file, reason }] : [];
  });
  const seen = new Set();
  let duplicateFiles = 0, duplicateBytes = 0;
  for (const file of files) {
    if (seen.has(file.hash)) { duplicateFiles++; duplicateBytes += file.bytes; }
    seen.add(file.hash);
  }
  return { mode: source ? 'source' : staged ? 'staged' : ref ? `ref:${ref}` : 'worktree',
    root, count: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), duplicateFiles, duplicateBytes,
    manifestSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), violations, files };
}

function main(argv) {
  const options = {};
  let json = false, audit = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--root', '--source', '--ref'].includes(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value: ${arg}`);
      options[arg.slice(2)] = argv[++i];
    } else if (arg === '--staged') options.staged = true;
    else if (arg === '--json') json = true;
    else if (arg === '--allow-existing-legacy') audit = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if ([options.source, options.staged, options.ref].filter(Boolean).length > 1) throw new Error('Choose one source mode');
  const report = inspectLayout(options);
  report.auditOnly = audit;
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${audit ? 'AUDIT ONLY' : 'LAYOUT'} ${report.mode}: ${report.count} files, ${report.bytes} bytes, ${report.duplicateFiles} duplicate extras; manifest ${report.manifestSha256}`);
    console.log(`${report.violations.length} forbidden paths`);
    for (const item of report.violations.slice(0, 20)) console.log(`${item.reason}: ${item.path}`);
  }
  if (report.violations.length && !audit) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
