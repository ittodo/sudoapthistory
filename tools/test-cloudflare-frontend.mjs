import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const pages = ['index.html', 'compare/index.html', 'div/index.html', 'div/stocks/detail.html', 'account/index.html', 'admin/index.html'];
for (const path of pages) {
  const source = read(path);
  assert.doesNotMatch(source, /supabase|__supabaseClient/i, path);
  assert.match(source, /js\/auth-client\.js/, path);
  for (const match of source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1], { filename: path });
}
new vm.Script(read('js/comments.js'));
const source = read('js/auth-client.js');
const calls = [];
let auth = { session: { user: { id: 'new-user', email: 'test@example.invalid' } }, profile: null, isAdmin: false, csrfToken: 'test-csrf' };
let failure = null;
let redirected = '';
const context = vm.createContext({
  window: {}, URLSearchParams, crypto: webcrypto,
  location: { pathname: '/div/stocks/detail.html', search: '?code=005930', hash: '#tags', assign: url => { redirected = url; } },
  fetch: async (path, options) => {
    calls.push({ path, options });
    if (failure) return { ok: false, status: failure.status, json: async () => failure.body };
    return { ok: true, status: 200, json: async () => path === '/api/session' ? auth : path === '/api/profile' ? { profile: { nickname: 'newname' } } : { ok: true } };
  }
});
vm.runInContext(source, context);
const client = context.window.NodoAPI;
await Promise.all([client.getState(), client.getState()]);
assert.equal(calls.length, 1, 'parallel initial session reads are deduplicated');
assert.equal(calls[0].options.credentials, 'same-origin');
assert.equal(calls[0].options.cache, 'no-store');
await client.saveProfile('newname');
assert.equal(calls.at(-1).options.headers['X-CSRF-Token'], 'test-csrf');
assert.equal(calls.at(-1).options.method, 'PATCH');
assert.equal((await client.getState()).profile.nickname, 'newname');
await assert.rejects(client.request('https://external.invalid/api/x'), /허용되지 않은/);
client.login(true);
const redirect = new URL(redirected, 'https://nodostream.com');
assert.equal(redirect.pathname, '/auth/google');
assert.equal(redirect.searchParams.get('reauth'), '1');
assert.equal(redirect.searchParams.get('returnTo'), '/div/stocks/detail.html?code=005930#tags');
failure = { status: 403, body: { error: { code: 'REAUTH_REQUIRED', message: 'reauthenticate' } } };
await assert.rejects(client.request('/api/account', { method: 'DELETE', body: '{}' }), error => error.code === 'REAUTH_REQUIRED' && error.message === 'reauthenticate');
let loggedOut = false;
client.onChange(() => { loggedOut = true; });
failure = { status: 503, body: { error: { code: 'MAINTENANCE', message: 'maintenance' } } };
await assert.rejects(client.logout(), /maintenance/);
assert.equal(loggedOut, false, 'failed logout must not report success');
failure = { status: 503, body: { error: { code: 'UNAVAILABLE', message: 'retry' } } };
await assert.rejects(client.create('/api/comments', { content: 'hello' }), /retry/);
const retryKey = calls.at(-1).options.headers['Idempotency-Key'];
failure = null;
await client.create('/api/comments', { content: 'hello' });
assert.equal(calls.at(-1).options.headers['Idempotency-Key'], retryKey, 'same uncertain creation retry retains request identity');
await client.logout();
assert.equal(loggedOut, true);
auth = { session: null, profile: null, isAdmin: false, csrfToken: null };
const before = calls.length;
await assert.rejects(client.saveProfile('anonymous'), /로그인이 필요/);
assert.equal(calls.length, before + 1, 'anonymous writer only reads session and never submits write');
assert.doesNotMatch(source, /localStorage|sessionStorage|console\.log/);
assert.match(read('account/index.html'), /REAUTH_REQUIRED/);
assert.match(read('account/index.html'), /기존 닉네임·댓글·추천·사용자 태그는 이전되지 않습니다/);
assert.match(read('div/stocks/detail.html'), /const publicTags =/);
console.log('Cloudflare frontend: syntax, SDK removal, session, CSRF, authentication failure, logout, redirect and new-start contract passed.');
