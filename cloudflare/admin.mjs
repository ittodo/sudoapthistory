// Explicit operator-only role assignment. Never called by the public Worker.
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const environment = value('--env');
const user = value('--user');
const subject = value('--google-sub');
if (!['staging', 'production'].includes(environment) || !/^[a-f0-9-]{36}$/i.test(user || '') || !/^[A-Za-z0-9_-]{1,255}$/.test(subject || '') || !args.includes('--confirm-grant-admin')) {
  console.error('Usage: node cloudflare/admin.mjs --env staging|production --user UUID --google-sub VERIFIED_SUB --confirm-grant-admin');
  process.exit(1);
}
const sql = `UPDATE users SET role='admin' WHERE id='${user}' AND google_sub='${subject}' RETURNING id,role;`;
const options = ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--remote', '--command', sql];
if (environment === 'production') options.push('--env', 'production');
const result = spawnSync(process.execPath, options, { stdio: 'inherit', shell: false });
process.exit(result.status ?? 1);
