import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare,createFetchMock } from 'miniflare';
import {readyWithdrawal,withdrawalKey} from './withdrawal-fixture';
import {purgeAccounts,RECOVERY_SECONDS} from '../src/account-lifecycle';

const digest = (s:string) => createHash('sha256').update(s).digest('hex');
const origin = 'https://nodostream.com';

test('independent security regression: access control, private fields and erasure', async () => {
  const bundle = await build({ entryPoints: ['cloudflare/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const mock=createFetchMock();mock.disableNetConnect();mock.get('https://oauth2.googleapis.com').intercept({path:'/revoke',method:'POST'}).reply(200,'');
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', d1Databases: ['DB'],fetchMock:mock, bindings: { SITE_ORIGIN: origin, MAINTENANCE: 'false', RELEASE_SHA: 'test', GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'test',WITHDRAWAL_ENABLED:'true',WITHDRAWAL_ENCRYPTION_KEY:withdrawalKey } });
  try {
    const db = await mf.getD1Database('DB');
    await db.exec(readFileSync('cloudflare/migrations/0001_initial.sql', 'utf8'));
    for(const sql of readFileSync('cloudflare/migrations/0002_withdrawal_requests.sql','utf8').split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
    const now = Math.floor(Date.now()/1000);
    for (const [id,role] of [['alice','user'],['bob','user'],['admin','admin']]) {
      await db.prepare('INSERT INTO users(id,google_sub,email,role) VALUES(?,?,?,?)').bind(id, 'google-'+id, id+'@example.invalid', role).run();
      await db.prepare('INSERT INTO profiles(user_id,nickname) VALUES(?,?)').bind(id,id).run();
      await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,authenticated_at) VALUES(?,?,?,?)').bind(digest('token-'+id),id,now+3600,now).run();
    }
    const request = (path:string, who:string|null = null, method='GET', payload?:unknown, extra:Record<string,string>={}) => mf.dispatchFetch(origin+path, { method, headers: {
      ...(who?{Cookie:'__Host-nodo_session=token-'+who,'X-CSRF-Token':digest('csrf:token-'+who)}:{}),
      ...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'}), ...extra
    }, ...(payload===undefined?{}:{body:JSON.stringify(payload)}) });
    assert.equal((await request('/api/admin/stats')).status,403);
    assert.equal((await request('/api/admin/comments','alice')).status,403);
    assert.equal((await request('/api/profile','alice','PATCH',{nickname:'alice2',role:'admin',user_id:'bob'},{Origin:'https://evil.invalid'})).status,403);
    assert.equal((await request('/api/profile','alice','PATCH',{nickname:'alice2'},{'X-CSRF-Token':'wrong'})).status,403);
    assert.equal((await request('/api/profile',null,'PATCH',{nickname:'anonymous'})).status,401);
    const create = await request('/api/comments','alice','POST',{page_id:'test',content:'private audit payload',user_id:'bob'},{'Idempotency-Key':'security-review-root'});
    assert.equal(create.status,201);
    const root = (await create.json() as any).data;
    assert.equal(root.user_id,'alice','client-supplied author cannot impersonate another member');
    const twice = await request('/api/comments','alice','POST',{page_id:'test',content:'private audit payload'},{'Idempotency-Key':'security-review-root'});
    assert.equal((await twice.json() as any).data.id,root.id);
    assert.equal((await request('/api/comments/'+root.id,'bob','PATCH',{content:'hacked'})).status,404);
    assert.equal((await request('/api/comments/'+root.id,'bob','DELETE',{})).status,404);
    const replyResponse = await request('/api/comments','bob','POST',{page_id:'test',content:'bob reply',parent_id:root.id},{'Idempotency-Key':'security-review-reply'});
    assert.equal(replyResponse.status,201);
    const reply = (await replyResponse.json() as any).data;
    for (let i=0;i<5;i++) await db.prepare('INSERT INTO comments(user_id,page_id,content,parent_id) VALUES(?,?,?,?)').bind('bob','test','extra reply '+i,root.id).run();
    const publicResponse = await request('/api/comments?page_id=test');
    const publicRows = (await publicResponse.json() as any).data;
    assert.equal(publicRows[0].reply_count,6);
    assert.equal(publicRows.length,4,'preview contains parent and three replies');
    const remaining = await request('/api/comments/'+root.id+'/replies?offset=3&limit=20');
    const remainingData = await remaining.json() as any;
    assert.equal(remainingData.count,6); assert.equal(remainingData.data.length,3,'remaining replies are reachable via pagination');
    assert.equal((await request('/api/comments/'+root.id+'/replies?limit=101')).status,400);
    for (const row of publicRows) for (const field of ['request_key','request_hash','moderation_reason','google_sub','email']) assert.equal(field in row,false,'public comment leaked '+field);
    assert.equal((await request('/api/comments?'+new URLSearchParams({page_id:'test',limit:'101'}))).status,400);
    assert.equal((await request('/api/profile','alice','PATCH',{nickname:'<script>'})).status,400);
    assert.equal((await request('/api/comments/'+root.id+'/like','bob','PUT',{liked:true})).status,200);
    assert.equal((await request('/api/comments/'+root.id+'/like','bob','PUT',{liked:true})).status,200);
    assert.equal((await db.prepare('SELECT count(*) n FROM comment_likes WHERE comment_id=?').bind(root.id).first() as any).n,1);
    assert.equal((await request('/api/admin/comments/'+root.id+'/moderation','alice','PUT',{hidden:true,category:'unauthorized'})).status,403);
    assert.equal((await request('/api/admin/comments/'+root.id+'/moderation','admin','PUT',{hidden:true,category:'review',detail:'internal reason'})).status,200);
    assert.equal((await (await request('/api/comments?page_id=test')).json() as any).data.length,0,'hidden parent hides replies');
    assert.equal((await request('/api/admin/comments/'+root.id+'/moderation','admin','PUT',{hidden:false})).status,200);
    await db.prepare('UPDATE sessions SET reauthenticated_at=? WHERE user_id=?').bind(now-601,'alice').run();
    assert.equal((await request('/api/account','alice','DELETE',{})).status,403,'old session requires reauthentication');
    await db.prepare('UPDATE sessions SET reauthenticated_at=? WHERE user_id=?').bind(now,'alice').run();
    const receipt=await readyWithdrawal(db,origin,'alice','token-alice');
    assert.equal((await request('/api/account','alice','DELETE',{}, {Cookie:'__Host-nodo_session=token-alice; '+receipt.cookie})).status,200);
    await purgeAccounts(db as any,Math.floor(Date.now()/1000)+RECOVERY_SECONDS);
    assert.equal(await db.prepare('SELECT id FROM users WHERE id=?').bind('alice').first(),null);
    assert.equal((await db.prepare('SELECT content FROM comments WHERE id=?').bind(reply.id).first() as any).content,'bob reply','other authors replies must survive');
    const erased = await db.prepare('SELECT * FROM comments WHERE id=?').bind(root.id).first() as any;
    assert.equal(erased.content,''); assert.equal(erased.user_id,null);
    assert.equal(erased.request_key,null); assert.equal(erased.request_hash,null);
    const erasedPublic = await (await request('/api/comments?page_id=test')).json() as any;
    assert.equal(erasedPublic.data.length,4,'erased parent placeholder preserves reply preview');
    assert.equal(erasedPublic.data[0].is_deleted,true);
    assert.equal(erasedPublic.data[0].user_id,null);
    assert.equal(erasedPublic.data[0].content,'삭제된 댓글입니다.');
    assert.equal((await (await request('/api/comments/'+root.id+'/replies?offset=3')).json() as any).data.length,3);
    const expired = await request('/api/session','alice');
    assert.equal((await expired.json() as any).session,null,'account erasure invalidates all sessions');
  } finally { await mf.dispose(); }
});
