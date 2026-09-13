import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,createFetchMock} from 'miniflare';
import {purgeExpiredComments,moderationCutoff} from '../src/comment-retention';
import {readyWithdrawal,withdrawalKey} from './withdrawal-fixture';
import {purgeAccounts,expireAccounts,issueRecovery,RECOVERY_SECONDS} from '../src/account-lifecycle';

const origin='https://test.example';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const bundle=await build({entryPoints:['cloudflare/src/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const sql=await readFile('cloudflare/migrations/0001_initial.sql','utf8');
async function setup(maintenance=false){
 const mock=createFetchMock();mock.disableNetConnect();
 const options={modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-01',d1Databases:['DB'],bindings:{SITE_ORIGIN:origin,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'fake-secret',RELEASE_SHA:'abc123',MAINTENANCE:String(maintenance),AUTH_ENABLED:'true',WITHDRAWAL_ENABLED:'true',WITHDRAWAL_ENCRYPTION_KEY:withdrawalKey},serviceBindings:{ASSETS:()=>new Response('asset',{status:404})},fetchMock:mock};
 const mf=new Miniflare(options);
 const db=await mf.getD1Database('DB');for(const s of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(s).run();
 for(const statement of (await readFile('cloudflare/migrations/0002_withdrawal_requests.sql','utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(statement).run();
 async function withdrawal(headers:Record<string,string>){
  const sessionToken=headers.Cookie.split('=')[1];const uid=sessionToken.slice('session-token-'.length);
  const receipt=await readyWithdrawal(db,origin,uid,sessionToken);
  mock.get('https://oauth2.googleapis.com').intercept({path:'/revoke',method:'POST'}).reply(200,'');
  return {...headers,Cookie:headers.Cookie+'; '+receipt.cookie};
 }
 async function user(id:string,role='user',age=0){const raw='session-token-'+id;await db.batch([db.prepare('INSERT INTO users(id,google_sub,email,role) VALUES(?,?,?,?)').bind(id,'google-'+id,id+'@example.test',role),db.prepare('INSERT INTO profiles(user_id,nickname) VALUES(?,?)').bind(id,'닉네임'+id),db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,authenticated_at,reauthenticated_at) VALUES(?,?,?,?,?)').bind(digest(raw),id,Math.floor(Date.now()/1000)+604800,Math.floor(Date.now()/1000)-age,Math.floor(Date.now()/1000)-age)]);return {Cookie:'__Host-nodo_session='+raw,'X-CSRF-Token':digest('csrf:'+raw),Origin:origin}}
 async function request(path:string,method='GET',data?:unknown,headers:Record<string,string>={}){
  if(method==='GET'&&path.startsWith('/auth/google')&&new URL(origin+path).searchParams.get('reauth')!=='1'){
   const gate=await mf.dispatchFetch(origin+path,{redirect:'manual'});if(gate.status!==200)return gate;
   const html=await gate.text(),csrf=html.match(/name="csrf" value="([a-f0-9]{64})"/)![1],Cookie=gate.headers.get('set-cookie')!.match(/__Host-nodo_age=[^;]+/)![0];
   return mf.dispatchFetch(origin+path,{method:'POST',redirect:'manual',headers:{Origin:origin,Cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,age14:'yes'}).toString()});
  }
  return mf.dispatchFetch(origin+path,{method,redirect:'manual',headers:{...headers,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)})}
 return {mf,db,user,request,mock,options,withdrawal};
}
test('age self-declaration is unchecked, server-enforced and bound to OAuth state',async()=>{
 const s=await setup();try{
  const path=origin+'/auth/google?returnTo=%2Faccount%2F';
  const gate=await s.mf.dispatchFetch(path,{redirect:'manual'});assert.equal(gate.status,200);assert.equal(gate.headers.get('cache-control'),'no-store');
  assert.equal(gate.headers.get('referrer-policy'),'same-origin');
  assert.equal(gate.headers.get('content-security-policy')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('form-action ')),"form-action 'self' https://accounts.google.com");
  const html=await gate.text();assert.match(html,/name="age14" value="yes" required/);assert.doesNotMatch(html,/\bchecked\b/);
  assert.equal((await s.db.prepare('SELECT count(*) n FROM oauth_states').first() as any).n,0);
  const csrf=html.match(/name="csrf" value="([a-f0-9]{64})"/)![1],Cookie=gate.headers.get('set-cookie')!.match(/__Host-nodo_age=[^;]+/)![0];
  const post=(data:string,extra:Record<string,string>={})=>s.mf.dispatchFetch(path,{method:'POST',redirect:'manual',headers:{Origin:origin,Cookie,'Content-Type':'application/x-www-form-urlencoded',...extra},body:data});
  assert.equal((await post(new URLSearchParams({csrf}).toString())).status,400);
  assert.equal((await post(new URLSearchParams({csrf,age14:'no'}).toString())).status,400);
  assert.equal((await post(new URLSearchParams({csrf,age14:'yes'}).toString(),{Cookie:''})).status,403);
  for(const Origin of ['null',''])assert.equal((await post(new URLSearchParams({csrf,age14:'yes'}).toString(),{Origin})).status,403);
  const failed=await post(new URLSearchParams({csrf,age14:'yes'}).toString(),{Cookie:''});
  assert.equal(failed.headers.get('content-type'),'application/json; charset=utf-8');
  assert.equal((await failed.json() as any).error.message,'연령 확인 화면을 다시 열어 주세요.');
  assert.equal((await post(new URLSearchParams({csrf,age14:'yes'}).toString(),{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await post('x'.repeat(16385))).status,413);
  const passed=await post(new URLSearchParams({csrf,age14:'yes'}).toString());assert.equal(passed.status,302);
  const dest=new URL(passed.headers.get('location')!),state=dest.searchParams.get('state')!;
  assert.ok(dest.searchParams.get('nonce')!.startsWith('age14-v1:'));
  assert.equal((await s.db.prepare('SELECT count(*) n FROM users').first() as any).n,0);
  await s.db.prepare('UPDATE oauth_states SET nonce=? WHERE state_hash=?').bind('legacy-nonce',digest(state)).run();
  assert.equal((await s.mf.dispatchFetch(origin+'/auth/callback?code=fake&state='+state,{headers:{Cookie:'__Host-nodo_oauth='+state}})).status,403);
  assert.equal((await s.db.prepare('SELECT count(*) n FROM users').first() as any).n,0);
 }finally{await s.mf.dispose();}
});

test('session CSRF, ownership, replies, idempotency, moderation and account deletion',async()=>{
 const s=await setup();try{
 const a=await s.user('a'),b=await s.user('b'),admin=await s.user('admin','admin');
 const empty=await s.request('/api/session');assert.equal((await empty.json() as any).session,null);
 const state=await s.request('/api/session','GET',undefined,a);assert.equal((await state.json() as any).csrfToken,a['X-CSRF-Token']);
 assert.equal((await s.request('/api/profile','PATCH',{nickname:'변경'},{...a,Origin:'https://evil.test'})).status,403);
 assert.equal((await s.request('/api/profile','PATCH',{nickname:'변경'},{...a,'X-CSRF-Token':'bad'})).status,403);
 const key={'Idempotency-Key':'request-comment-root-1'};const create=await s.request('/api/comments','POST',{page_id:'test',content:'부모'}, {...a,...key});assert.equal(create.status,201);const root=(await create.json() as any).data.id;
 const repeat=await s.request('/api/comments','POST',{page_id:'test',content:'부모'}, {...a,...key});assert.equal((await repeat.json() as any).data.id,root);
 assert.equal((await s.request('/api/comments','POST',{page_id:'test',content:'다름'}, {...a,...key})).status,409);
 const reply=await s.request('/api/comments','POST',{page_id:'test',content:'답글',parent_id:root},{...b,'Idempotency-Key':'request-comment-reply-1'});assert.equal(reply.status,201);const replyId=(await reply.json() as any).data.id;
 assert.equal((await s.request('/api/comments/'+root,'PATCH',{content:'공격'},b)).status,404);
 assert.equal((await s.request('/api/admin/stats','GET',undefined,b)).status,403);
 assert.equal((await s.request('/api/comments/'+root+'/like','PUT',{liked:true},b)).status,200);await s.request('/api/comments/'+root+'/like','PUT',{liked:true},b);assert.equal((await s.db.prepare('SELECT count(*) n FROM comment_likes').first() as any).n,1);
 assert.equal((await s.request('/api/admin/comments/'+root+'/moderation','PUT',{hidden:true,category:'spam'},admin)).status,200);
 assert.deepEqual((await (await s.request('/api/comments?page_id=test')).json() as any).data,[]);
 assert.equal((await s.request('/api/comments/'+replyId+'/like','PUT',{liked:true},b)).status,404);
 await s.request('/api/admin/comments/'+root+'/moderation','PUT',{hidden:false},admin);
 assert.equal((await (await s.request('/api/comments?page_id=test')).json() as any).data.length,2);
 assert.equal((await s.request('/api/account','DELETE',undefined,await s.withdrawal(a))).status,200);
 assert.equal((await s.db.prepare("SELECT status FROM users WHERE id='a'").first() as any).status,'withdrawn');
 await purgeAccounts(s.db as any,Math.floor(Date.now()/1000)+RECOVERY_SECONDS);
 assert.equal((await s.db.prepare('SELECT content FROM comments WHERE id=?').bind(replyId).first() as any).content,'답글');
 assert.equal((await s.db.prepare('SELECT content FROM comments WHERE id=?').bind(root).first() as any).content,'');
 assert.equal(await s.db.prepare('SELECT * FROM users WHERE id=?').bind('a').first(),null);
 const after=await (await s.request('/api/comments?page_id=test')).json() as any;
 assert.equal(after.count,1);assert.equal(after.data.length,2);
 assert.equal(after.data[0].is_deleted,true);assert.equal(after.data[0].content,'삭제된 댓글입니다.');
 assert.equal(after.data[0].user_id,null);assert.equal(after.data[1].content,'답글');
 }finally{await s.mf.dispose()}
});
test('deleted roots mask private content but preserve reply pagination and owner actions',async()=>{
 const s=await setup();try{
 const a=await s.user('a'),b=await s.user('b'),admin=await s.user('admin','admin');
 await s.db.prepare("INSERT INTO comments(user_id,page_id,content) VALUES('a','deleted','secret root')").run();
 for(let i=0;i<5;i++)await s.db.prepare("INSERT INTO comments(user_id,page_id,content,parent_id) VALUES('b','deleted',?,1)").bind('reply '+i).run();
 assert.equal((await s.request('/api/comments/1','DELETE',undefined,a)).status,200);
 const erased=await s.db.prepare('SELECT content,user_id,request_key,request_hash,updated_at,moderation_reason FROM comments WHERE id=1').first();
 assert.deepEqual(erased,{content:'',user_id:null,request_key:null,request_hash:null,updated_at:null,moderation_reason:null});
 const list=await (await s.request('/api/comments?page_id=deleted')).json() as any;
 assert.equal(list.count,1);assert.equal(list.data.length,4);assert.equal(list.data[0].reply_count,5);
 assert.equal(list.data[0].content,'삭제된 댓글입니다.');assert.equal(list.data[0].profiles.nickname,'삭제된 댓글');
 assert.equal(JSON.stringify(list).includes('secret root'),false);assert.equal(list.data[0].user_id,null);
 const rest=await (await s.request('/api/comments/1/replies?offset=3')).json() as any;
 assert.equal(rest.count,5);assert.equal(rest.data.length,2);
 assert.equal((await s.request('/api/comments/1/like','PUT',{liked:true},b)).status,404);
 assert.equal((await s.request('/api/comments/1','PATCH',{content:'revive'},a)).status,404);
 assert.equal((await s.request('/api/comments','POST',{page_id:'deleted',content:'new',parent_id:1},{...b,'Idempotency-Key':'deleted-root-new-reply'})).status,404);
 assert.equal((await s.request('/api/comments/2','PATCH',{content:'edited reply'},b)).status,200);
 assert.equal((await s.request('/api/comments/2/like','PUT',{liked:true},a)).status,200);
 await s.request('/api/admin/comments/2/moderation','PUT',{hidden:true,category:'test'},admin);
 assert.equal((await (await s.request('/api/comments/1/replies')).json() as any).count,4);
 for(let id=2;id<=6;id++)assert.equal((await s.request('/api/comments/'+id,'DELETE',undefined,b)).status,200);
 assert.deepEqual((await (await s.request('/api/comments?page_id=deleted')).json() as any).data,[]);
 assert.equal((await s.request('/api/comments/1/replies')).status,404);
 }finally{await s.mf.dispose()}
});
test('moderation retention preserves replies, expires at 30 days, and cannot be extended by retries',async()=>{
 const s=await setup();try{
 const a=await s.user('a'),b=await s.user('b'),admin=await s.user('admin','admin');
 await s.db.prepare("INSERT INTO comments(user_id,page_id,content) VALUES('a','retention','root')").run();
 await s.db.prepare("INSERT INTO comments(user_id,page_id,content,parent_id) VALUES('b','retention','reply',1)").run();
 await s.request('/api/comments/1/like','PUT',{liked:true},b);
 assert.equal((await s.request('/api/comments/1','DELETE',undefined,b)).status,404);
 assert.equal((await s.db.prepare('SELECT count(*) n FROM comment_likes').first() as any).n,1);
 await s.request('/api/admin/comments/1/moderation','PUT',{hidden:true,category:'spam'},admin);
 const initial=(await s.db.prepare('SELECT moderated_at FROM comments WHERE id=1').first() as any).moderated_at;
 await s.request('/api/admin/comments/1/moderation','PUT',{hidden:true,category:'spam'},admin);
 assert.equal((await s.db.prepare('SELECT moderated_at FROM comments WHERE id=1').first() as any).moderated_at,initial);
 assert.equal((await s.request('/api/admin/comments/1/moderation','PUT',{hidden:false},admin)).status,200);
 const time=Date.now(),cutoff=moderationCutoff(time);
 await s.db.prepare('UPDATE comments SET moderated_at=?,moderation_reason=? WHERE id=1').bind(cutoff,JSON.stringify({category:'test'})).run();
 await s.db.prepare("INSERT INTO comments(user_id,page_id,content,moderated_at) VALUES('a','retention','not expired',?)").bind(new Date(Date.parse(cutoff)+60000).toISOString()).run();
 assert.equal((await s.request('/api/admin/comments/1/moderation','PUT',{hidden:false},admin)).status,404);
 assert.equal((await s.request('/api/admin/comments/1/moderation','PUT',{hidden:true,category:'retry'},admin)).status,404);
 await purgeExpiredComments(s.db as any,time);
 const root=await s.db.prepare('SELECT * FROM comments WHERE id=1').first() as any;
 assert.equal(root.content,'');assert.equal(root.user_id,null);assert.equal(root.moderation_reason,null);assert.equal(root.moderated_at,cutoff);assert.ok(root.deleted_at);
 assert.equal((await s.db.prepare('SELECT count(*) n FROM comment_likes').first() as any).n,0);
 assert.equal((await s.db.prepare('SELECT content FROM comments WHERE id=2').first() as any).content,'reply');
 assert.equal((await s.db.prepare('SELECT content FROM comments WHERE id=3').first() as any).content,'not expired');
 assert.deepEqual((await (await s.request('/api/comments?page_id=retention')).json() as any).data,[]);
 assert.equal((await s.request('/api/admin/comments/1/moderation','PUT',{hidden:false},admin)).status,404);
 await purgeExpiredComments(s.db as any,time);
 assert.equal((await s.db.prepare('SELECT count(*) n FROM comments').first() as any).n,3);
 }finally{await s.mf.dispose()}
});
test('tags atomic and idempotent, direction change, account cascade and quota boundaries',async()=>{
 const s=await setup();try{const a=await s.user('a');
 for(let i=0;i<20;i++){const response=await s.request('/api/stocks/005930/tags','POST',{name:'태그'+i},a);assert.equal(response.status,201,await response.text());}
 assert.equal((await s.request('/api/stocks/005930/tags','POST',{name:'초과'},a)).status,429);
 const tags=await (await s.request('/api/stocks/005930/tags','GET',undefined,a)).json() as any;assert.equal(tags.data.length,20);const id=tags.data[0].tag_id;
 for(const vote of ['down','down','up',null])assert.equal((await s.request('/api/tags/'+id+'/vote','PUT',{vote},a)).status,200);
 assert.equal(await s.db.prepare('SELECT * FROM tag_votes WHERE tag_id=?').bind(id).first(),null);
 await s.request('/api/account','DELETE',undefined,await s.withdrawal(a));await purgeAccounts(s.db as any,Math.floor(Date.now()/1000)+RECOVERY_SECONDS);assert.equal((await s.db.prepare('SELECT count(*) n FROM tags').first() as any).n,20);assert.equal((await s.db.prepare('SELECT count(*) n FROM tag_votes').first() as any).n,0);
 }finally{await s.mf.dispose()}
});
test('30 writes per minute, body limits, expired sessions, maintenance and no-store 404',async()=>{
 const s=await setup();try{const a=await s.user('a'),old=await s.user('old','user',601);assert.equal((await s.request('/api/account','DELETE',undefined,old)).status,403);
 assert.equal((await s.request('/api/profile','PATCH',{nickname:'x'.repeat(20000)},a)).status,413);
 for(let i=0;i<29;i++)assert.equal((await s.request('/api/profile','PATCH',{nickname:'테스트'},a)).status,200);
 // Pin saturated buckets at the assertion boundary; wall-clock minute rollover is not a quota bug.
 const bucket=Math.floor(Date.now()/60000);for(const n of [bucket,bucket+1])await s.db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,30,?) ON CONFLICT(key) DO UPDATE SET count=30').bind('write:a:'+n,(n+2)*60).run();
 assert.equal((await s.request('/api/profile','PATCH',{nickname:'테스트'},a)).status,429);
 const missing=await s.request('/api/missing');assert.equal(missing.status,404);assert.equal(missing.headers.get('cache-control'),'no-store');
 await s.db.prepare('UPDATE sessions SET expires_at=0').run();assert.equal((await (await s.request('/api/session','GET',undefined,a)).json() as any).session,null);
 }finally{await s.mf.dispose()}
 const m=await setup(true);try{const a=await m.user('a');assert.equal((await m.request('/api/profile','PATCH',{nickname:'변경'},a)).status,503);const health=await (await m.request('/api/health')).json() as any;assert.equal(health.maintenance,true);assert.equal(health.gitSha,'abc123');assert.equal((await m.request('/data/missing.json')).status,404)}finally{await m.mf.dispose()}
});

test('OAuth state TTL, PKCE, JWT nonce/audience/issuer/signature validation and one-use callback',async()=>{
 const s=await setup();try{
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});const jwk={...publicKey.export({format:'jwk'}),kid:'test',alg:'RS256',use:'sig'};
 s.mock.get('https://www.googleapis.com').intercept({path:'/oauth2/v3/certs'}).reply(200,{keys:[jwk]},{headers:{'content-type':'application/json'}}).persist();
 async function flow(change:Record<string,unknown>={},badSignature=false,reauthCookie?:string,withdrawal=false){
  const start=await s.request('/auth/google?returnTo=%2Faccount%2F'+(reauthCookie?'&reauth=1':'')+(withdrawal?'&withdrawal=1':''),'GET',undefined,reauthCookie?{Cookie:reauthCookie}:{});assert.equal(start.status,302);assert.equal(start.headers.get('referrer-policy'),'no-referrer');const dest=new URL(start.headers.get('location')!);assert.equal(dest.searchParams.get('code_challenge_method'),'S256');assert.ok(dest.searchParams.get('code_challenge'));if(reauthCookie)assert.equal(dest.searchParams.get('prompt'),'select_account');
  const state=dest.searchParams.get('state')!,nonce=dest.searchParams.get('nonce')!;const n=Math.floor(Date.now()/1000);const payload={iss:'https://accounts.google.com',aud:'test-client',sub:'new-google-id',email:'new@example.test',email_verified:true,iat:n,exp:n+300,nonce,...change};
  const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url'),data=Buffer.from(JSON.stringify(payload)).toString('base64url');const signing=head+'.'+data;const signature=badSignature?Buffer.alloc(256):sign('RSA-SHA256',Buffer.from(signing),privateKey);const jwt=signing+'.'+signature.toString('base64url');
  s.mock.get('https://oauth2.googleapis.com').intercept({path:'/token',method:'POST'}).reply(200,{access_token:'fake',expires_in:3600,token_type:'Bearer',id_token:jwt},{headers:{'content-type':'application/json'}});
  const callback='/auth/callback?code=fake&state='+state,headers={Cookie:'__Host-nodo_oauth='+state+(reauthCookie?'; '+reauthCookie:'')};const result=await s.request(callback,'GET',undefined,headers);assert.equal((await s.request(callback,'GET',undefined,headers)).status,400);return result;
 }
 for(const change of [{nonce:'wrong'},{aud:'wrong'},{iss:'https://evil.test'},{exp:1}])assert.equal((await flow(change)).status,400);
 assert.equal((await flow({},true)).status,400);
 assert.equal((await s.db.prepare('SELECT count(*) n FROM users').first() as any).n,0);
 const good=await flow();assert.equal(good.status,302);assert.equal(good.headers.get('location'),origin+'/account/');assert.equal(good.headers.get('referrer-policy'),'no-referrer');assert.match(good.headers.get('set-cookie')!,/HttpOnly; Secure; SameSite=Lax/);
 const row=await s.db.prepare('SELECT * FROM users').first() as any;assert.equal(row.google_sub,'new-google-id');assert.equal(row.role,'user');assert.notEqual(row.id,row.google_sub);
 const existingCookie=good.headers.get('set-cookie')!.match(/__Host-nodo_session=[^;]+/)![0];
 assert.equal((await flow({sub:'different-google-account'},false,existingCookie)).status,400);
 assert.equal((await (await s.request('/api/session','GET',undefined,{Cookie:existingCookie})).json() as any).session.user.id,row.id);
 assert.equal((await s.db.prepare('SELECT reauthenticated_at FROM sessions').first() as any).reauthenticated_at,null);
 assert.equal((await flow({},false,existingCookie)).status,302);
 assert.ok((await s.db.prepare('SELECT reauthenticated_at FROM sessions').first() as any).reauthenticated_at>0);
 const csrf=digest('csrf:'+existingCookie.split('=')[1]);
 const prepared=await s.request('/api/account/withdrawal/start','POST',{}, {Cookie:existingCookie,Origin:origin,'X-CSRF-Token':csrf});
 assert.equal(prepared.status,200);
 const withdrawalCookie=prepared.headers.get('set-cookie')!.split(';')[0],both=existingCookie+'; '+withdrawalCookie;
 assert.equal((await flow({sub:'wrong-withdrawal-account'},false,both,true)).status,400);
 const verified=await flow({},false,both,true);assert.equal(verified.status,302);assert.equal(verified.headers.get('location'),origin+'/account/?withdrawal=confirm');
 assert.ok(await s.db.prepare('SELECT 1 FROM users WHERE id=?').bind(row.id).first(),'callback never deletes account');
 s.mock.get('https://oauth2.googleapis.com').intercept({path:'/revoke',method:'POST'}).reply(200,'');
 const finished=await s.request('/api/account/withdrawal/confirm','POST',{}, {Cookie:both,Origin:origin,'X-CSRF-Token':csrf});
 assert.equal(finished.status,200);assert.equal((await finished.json() as any).googleRevocation,'succeeded');
 s.mock.assertNoPendingInterceptors();
 const recoveryLogin=await flow();assert.equal(recoveryLogin.status,302);assert.equal(recoveryLogin.headers.get('location'),origin+'/account/?recovery=confirm');
 assert.equal((await s.db.prepare('SELECT count(*) n FROM sessions').first() as any).n,0,'Google authentication alone cannot restore a session');
 assert.equal((await s.db.prepare('SELECT status FROM users WHERE id=?').bind(row.id).first() as any).status,'withdrawn');
 await expireAccounts(s.db as any,Math.floor(Date.now()/1000)+RECOVERY_SECONDS,row.id);
 const afterDeadline=await flow();assert.equal(afterDeadline.status,302);assert.equal(afterDeadline.headers.get('location'),origin+'/account/');
 const replacement=await s.db.prepare("SELECT id FROM users WHERE google_sub='new-google-id'").first() as any;assert.notEqual(replacement.id,row.id);
 const start=await s.request('/auth/google');const state=new URL(start.headers.get('location')!).searchParams.get('state')!;await s.db.prepare('UPDATE oauth_states SET expires_at=0').run();assert.equal((await s.request('/auth/callback?code=fake&state='+state,'GET',undefined,{Cookie:'__Host-nodo_oauth='+state})).status,400);
 assert.equal((await s.request('/auth/callback?state=wrong','GET',undefined,{Cookie:'__Host-nodo_oauth=other'})).status,400);
 }finally{await s.mf.dispose()}
});

test('withdrawal is mandatory, scoped, encrypted, one-use and reports Google failure separately',async()=>{
 const s=await setup();try{
  const a=await s.user('a'),b=await s.user('b');
  assert.equal((await s.request('/api/account','DELETE',undefined,a)).status,403);
  assert.equal((await s.request('/api/account/withdrawal/start','POST',{}, {...a,Origin:'https://evil.test'})).status,403);
  const start=await s.request('/api/account/withdrawal/start','POST',{},a);assert.equal(start.status,200);
  const receiptCookie=start.headers.get('set-cookie')!.split(';')[0];
  const headers={...a,Cookie:a.Cookie+'; '+receiptCookie};
  assert.equal((await s.request('/api/account/withdrawal/confirm','POST',{},headers)).status,403);
  assert.equal((await s.request('/auth/google?reauth=1&withdrawal=1','GET',undefined,{...b,Cookie:b.Cookie+'; '+receiptCookie})).status,403);
  await s.request('/api/account/withdrawal/cancel','POST',{},headers);
  assert.equal((await s.request('/auth/google?reauth=1&withdrawal=1','GET',undefined,headers)).status,403);
  const ready=await readyWithdrawal(s.db,origin,'a','session-token-a');const confirmed={...a,Cookie:a.Cookie+'; '+ready.cookie};
  const stored=await s.db.prepare('SELECT encrypted_token FROM withdrawal_requests WHERE id=?').bind(ready.id).first() as any;
  assert.ok(stored.encrypted_token);assert.equal(stored.encrypted_token.includes('fake-withdrawal-access-token'),false);
  assert.equal((await s.request('/api/account/withdrawal/confirm','POST',{}, {...b,Cookie:b.Cookie+'; '+ready.cookie})).status,403);
  s.mock.get('https://oauth2.googleapis.com').intercept({path:'/revoke',method:'POST'}).reply(400,{error:'invalid_token'});
  const response=await s.request('/api/account/withdrawal/confirm','POST',{},confirmed);
  assert.equal(response.status,200);const outcome=await response.json() as any;
  assert.equal(outcome.accountWithdrawn,true);assert.equal(outcome.googleRevocation,'unconfirmed');
  s.mock.assertNoPendingInterceptors();
  assert.equal((await s.db.prepare("SELECT status FROM users WHERE id='a'").first() as any).status,'withdrawn');
  const remaining=await s.db.prepare('SELECT encrypted_token,user_id,session_hash FROM withdrawal_requests WHERE id=?').bind(ready.id).first();
  assert.deepEqual(remaining,{encrypted_token:null,user_id:'a',session_hash:null});
  assert.equal((await s.request('/api/account/withdrawal/confirm','POST',{},confirmed)).status,401);
  const status=await s.request('/api/account/withdrawal/status','GET',undefined,{Cookie:ready.cookie});
  assert.equal(status.headers.get('cache-control'),'no-store');assert.deepEqual(await status.json(),outcome);
  assert.equal((await (await s.request('/api/account/withdrawal/status')).json() as any).accountWithdrawn,false);
  await s.db.prepare('UPDATE withdrawal_requests SET expires_at=0 WHERE id=?').bind(ready.id).run();
  assert.equal((await (await s.request('/api/account/withdrawal/status','GET',undefined,{Cookie:ready.cookie})).json() as any).status,'expired');
 }finally{await s.mf.dispose()}
});

test('withdrawal stops before revocation on DB failure, bad token, expiry, or disabled feature',async()=>{
 const s=await setup();try{
  const a=await s.user('a');const ready=await readyWithdrawal(s.db,origin,'a','session-token-a');const headers={...a,Cookie:a.Cookie+'; '+ready.cookie};
  await s.db.prepare('UPDATE withdrawal_requests SET token_expires_at=0 WHERE id=?').bind(ready.id).run();
  assert.equal((await s.request('/api/account','DELETE',{},headers)).status,403);
  await s.db.prepare('UPDATE withdrawal_requests SET token_expires_at=?,encrypted_token=? WHERE id=?').bind(Math.floor(Date.now()/1000)+300,'broken',ready.id).run();
  assert.equal((await s.request('/api/account','DELETE',{},headers)).status,503);
  assert.ok(await s.db.prepare("SELECT 1 FROM users WHERE id='a'").first());
  const ready2=await readyWithdrawal(s.db,origin,'a','session-token-a');
  await s.db.prepare("CREATE TRIGGER fail_delete BEFORE UPDATE OF status ON users BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  assert.equal((await s.request('/api/account','DELETE',{}, {...a,Cookie:a.Cookie+'; '+ready2.cookie})).status,503);
  assert.ok(await s.db.prepare("SELECT 1 FROM users WHERE id='a'").first());
  assert.equal((await s.db.prepare('SELECT account_withdrawn FROM withdrawal_requests WHERE id=?').bind(ready2.id).first() as any).account_withdrawn,0);
  await s.mf.setOptions({...s.options,bindings:{...s.options.bindings,WITHDRAWAL_ENABLED:'false'}});
  assert.equal((await s.request('/api/account','DELETE',{},a)).status,503);
 }finally{await s.mf.dispose()}
});

test('withdrawal timeout and duplicate confirmation never claim full completion or repeat revocation',async()=>{
 const s=await setup();try{
  const a=await s.user('a');const ready=await readyWithdrawal(s.db,origin,'a','session-token-a');const headers={...a,Cookie:a.Cookie+'; '+ready.cookie};
  s.mock.get('https://oauth2.googleapis.com').intercept({path:'/revoke',method:'POST'}).reply(200,'').delay(6000);
  const responses=await Promise.all([s.request('/api/account/withdrawal/confirm','POST',{},headers),s.request('/api/account/withdrawal/confirm','POST',{},headers)]);
  assert.equal(responses.filter(r=>r.status===200).length,1);
  assert.ok(responses.some(r=>[401,403,409].includes(r.status)));
  const result=await responses.find(r=>r.status===200)!.json() as any;
  assert.equal(result.accountWithdrawn,true);assert.equal(result.googleRevocation,'unconfirmed');
  s.mock.assertNoPendingInterceptors();
 }finally{await s.mf.dispose()}
});

test('30-day recovery preserves identity, nickname, replies and valid votes without reversing moderation',async()=>{
 const s=await setup();try{
  const a=await s.user('a','admin'),b=await s.user('b'),admin=await s.user('operator','admin');
  await s.db.batch([
   s.db.prepare("INSERT INTO comments(id,user_id,page_id,content) VALUES(1,'a','recovery','private root')"),
   s.db.prepare("INSERT INTO comments(id,user_id,page_id,content,parent_id) VALUES(2,'b','recovery','other reply',1)"),
   s.db.prepare("INSERT INTO comments(id,user_id,page_id,content) VALUES(3,'a','recovery','delete me')"),
   s.db.prepare("INSERT INTO comments(id,user_id,page_id,content) VALUES(4,'a','recovery','moderated')"),
   s.db.prepare("INSERT INTO comment_likes(comment_id,user_id) VALUES(1,'b'),(2,'a')")
  ]);
  await s.request('/api/comments/3','DELETE',{},a);
  await s.request('/api/admin/comments/4/moderation','PUT',{hidden:true,category:'spam'},admin);
  await s.request('/api/stocks/005930/tags','POST',{name:'공유태그'},a);
  const response=await s.request('/api/account','DELETE',{},await s.withdrawal(a));const result=await response.json() as any;
  assert.equal(result.accountWithdrawn,true);assert.equal(result.googleRevocation,'succeeded');
  assert.ok(result.recoveryDeadline>=Math.floor(Date.now()/1000)+RECOVERY_SECONDS-1);
  assert.equal((await s.request('/api/profile','PATCH',{nickname:'no'},a)).status,401);
  assert.equal((await (await s.request('/api/session','GET',undefined,a)).json() as any).session,null);
  const publicData=await (await s.request('/api/comments?page_id=recovery')).json() as any;
  assert.equal(publicData.data[0].content,'탈퇴한 회원의 댓글입니다.');assert.equal(publicData.data[0].user_id,null);
  assert.equal(publicData.data[1].content,'other reply');assert.equal(publicData.data[1].comment_likes[0].count,0);
  assert.equal(JSON.stringify(publicData).includes('private root'),false);
  const tags=await (await s.request('/api/stocks/005930/tags')).json() as any;
  assert.equal(tags.data[0].tags.created_by,null);assert.equal(tags.data[0].tags.upvotes,0);
  assert.equal((await (await s.request('/api/profile?nickname='+encodeURIComponent('닉네임a'))).json() as any).available,false);
  const issued=await issueRecovery({DB:s.db,SITE_ORIGIN:origin} as any,'a');const recCookie=issued.headers.get('set-cookie')!.match(/__Host-nodo_recovery=[^;]+/)![0];
  const proof=await (await s.request('/api/account/recovery','GET',undefined,{Cookie:recCookie})).json() as any;
  assert.equal(proof.recoverable,true);
  const recHeaders={Cookie:recCookie,Origin:origin,'X-CSRF-Token':proof.csrfToken};
  assert.equal((await s.request('/api/account/recovery/confirm','POST',{}, {...recHeaders,Origin:'https://evil.test'})).status,403);
  assert.equal((await s.request('/api/account/recovery/confirm','POST',{},b)).status,403);
  const restored=await s.request('/api/account/recovery/confirm','POST',{},recHeaders);assert.equal(restored.status,200);
  assert.equal((await s.request('/api/account/recovery/confirm','POST',{},recHeaders)).status,409);
  const identity=await s.db.prepare("SELECT id,status,role FROM users WHERE google_sub='google-a'").first();
  assert.deepEqual(identity,{id:'a',status:'active',role:'user'});
  assert.equal((await s.db.prepare('SELECT content FROM comments WHERE id=3').first() as any).content,'');
  assert.ok((await s.db.prepare('SELECT moderated_at FROM comments WHERE id=4').first() as any).moderated_at);
  const restoredPublic=await (await s.request('/api/comments?page_id=recovery')).json() as any;
  assert.equal(restoredPublic.data[0].content,'private root');assert.equal(restoredPublic.data[1].comment_likes[0].count,1);
  assert.equal((await (await s.request('/api/stocks/005930/tags')).json() as any).data[0].tags.upvotes,1);
  const newCookie=restored.headers.get('set-cookie')!.match(/__Host-nodo_session=[^;]+/)![0];const again={Cookie:newCookie,Origin:origin,'X-CSRF-Token':digest('csrf:'+newCookie.split('=')[1])};
  const next=await readyWithdrawal(s.db,origin,'a',newCookie.split('=')[1]);s.mock.get('https://oauth2.googleapis.com').intercept({path:'/revoke',method:'POST'}).reply(200,'');
  assert.equal((await s.request('/api/account','DELETE',{}, {...again,Cookie:newCookie+'; '+next.cookie})).status,200);
  assert.equal((await s.db.prepare("SELECT withdrawal_generation FROM users WHERE id='a'").first() as any).withdrawal_generation,2);
 }finally{await s.mf.dispose()}
});

test('recovery deadline is strict and expiry releases nickname before bounded resumable erasure',async()=>{
 const s=await setup();try{
  await s.user('a');await s.user('b');const time=Math.floor(Date.now()/1000);
  await s.db.prepare("UPDATE users SET status='withdrawn',withdrawn_at=?,recovery_deadline=?,withdrawal_generation=1 WHERE id='a'").bind(time-RECOVERY_SECONDS+60,time+60).run();
  const ticket=await issueRecovery({DB:s.db,SITE_ORIGIN:origin} as any,'a');const recCookie=ticket.headers.get('set-cookie')!.match(/__Host-nodo_recovery=[^;]+/)![0];
  const proof=await (await s.request('/api/account/recovery','GET',undefined,{Cookie:recCookie})).json() as any;
  await s.db.prepare("UPDATE users SET recovery_deadline=? WHERE id='a'").bind(time).run();
  assert.equal((await s.request('/api/account/recovery/confirm','POST',{}, {Cookie:recCookie,Origin:origin,'X-CSRF-Token':proof.csrfToken})).status,409);
  await s.db.prepare("INSERT INTO comments(id,user_id,page_id,content) VALUES(1,'a','expiry','old')").run();
  await s.db.prepare("INSERT INTO comments(id,user_id,page_id,content,parent_id) VALUES(2,'b','expiry','survives',1)").run();
  for(let i=0;i<505;i++)await s.db.prepare("INSERT INTO comments(user_id,page_id,content) VALUES('a','expiry','old')").run();
  await expireAccounts(s.db as any,time,'a');
  assert.equal((await s.db.prepare("SELECT status FROM users WHERE id='a'").first() as any).status,'purging');
  assert.equal(await s.db.prepare("SELECT 1 FROM profiles WHERE user_id='a'").first(),null);
  assert.equal(await s.db.prepare("SELECT 1 FROM users WHERE google_sub='google-a'").first(),null);
  await purgeAccounts(s.db as any,time);assert.ok(await s.db.prepare("SELECT 1 FROM users WHERE id='a'").first());
  await purgeAccounts(s.db as any,time);assert.equal(await s.db.prepare("SELECT 1 FROM users WHERE id='a'").first(),null);
  assert.equal((await s.db.prepare('SELECT content FROM comments WHERE id=2').first() as any).content,'survives');
  await purgeAccounts(s.db as any,time);
 }finally{await s.mf.dispose()}
});

test('recovery cancellation, stale generations and concurrent expiry cannot reactivate a purging account',async()=>{
 const s=await setup();try{
  await s.user('a');const time=Math.floor(Date.now()/1000);
  await s.db.prepare("UPDATE users SET status='withdrawn',withdrawn_at=?,recovery_deadline=?,withdrawal_generation=1 WHERE id='a'").bind(time,time+60).run();
  const credentials=async()=>{
   const response=await issueRecovery({DB:s.db,SITE_ORIGIN:origin} as any,'a');const c=response.headers.get('set-cookie')!.match(/__Host-nodo_recovery=[^;]+/)![0];
   const proof=await (await s.request('/api/account/recovery','GET',undefined,{Cookie:c})).json() as any;
   return {Cookie:c,Origin:origin,'X-CSRF-Token':proof.csrfToken};
  };
  const cancelled=await credentials();assert.equal((await s.request('/api/account/recovery/cancel','POST',{},cancelled)).status,200);
  assert.equal((await s.request('/api/account/recovery/confirm','POST',{},cancelled)).status,409);
  const stale=await credentials();await s.db.prepare("UPDATE users SET withdrawal_generation=2 WHERE id='a'").run();
  assert.equal((await s.request('/api/account/recovery/confirm','POST',{},stale)).status,409);
  const racing=await credentials();
  const [response]=await Promise.all([s.request('/api/account/recovery/confirm','POST',{},racing),expireAccounts(s.db as any,time+60,'a')]);
  const row=await s.db.prepare("SELECT status,google_sub FROM users WHERE id='a'").first() as any;
  assert.ok(response.status===200||response.status===409);
  assert.equal(row.status,response.status===200?'active':'purging');
  assert.equal(row.google_sub,response.status===200?'google-a':'purged:a');
 }finally{await s.mf.dispose()}
});

test('compatible code rollback keeps new data; bootstrap auth separated from maintenance',async()=>{
 const s=await setup();try{
 const a=await s.user('a');const payload={page_id:'rollback',content:'보존해야 하는 새 글'};
 assert.equal((await s.request('/api/comments','POST',payload,{...a,'Idempotency-Key':'rollback-comment-key'})).status,201);
 await s.mf.setOptions({...s.options,bindings:{...s.options.bindings,RELEASE_SHA:'release-B'}});
 assert.equal((await (await s.request('/api/health')).json() as any).gitSha,'release-B');
 await s.mf.setOptions(s.options);
 assert.equal((await (await s.request('/api/comments?page_id=rollback')).json() as any).data[0].content,payload.content);
 assert.equal((await s.request('/api/comments','POST',{...payload,content:'복구 후 새 글'},{...a,'Idempotency-Key':'rollback-comment-key-2'})).status,201);
 await s.mf.setOptions({...s.options,bindings:{...s.options.bindings,MAINTENANCE:'true',AUTH_ENABLED:'false'}});
 assert.equal((await s.request('/auth/google')).status,503);
 await s.mf.setOptions({...s.options,bindings:{...s.options.bindings,MAINTENANCE:'true',AUTH_ENABLED:'true'}});
 assert.equal((await s.request('/auth/google')).status,302);
 assert.equal((await s.request('/api/profile','PATCH',{nickname:'불가'},a)).status,503);
 }finally{await s.mf.dispose()}
});

test('reply previews have explicit pagination and public rows never exceed 100',async()=>{
 const s=await setup();try{
 const a=await s.user('a');const result=await s.request('/api/comments','POST',{page_id:'page',content:'부모'},{...a,'Idempotency-Key':'pagination-root-key'});const id=(await result.json() as any).data.id;
 for(let i=0;i<8;i++)await s.db.prepare('INSERT INTO comments(user_id,page_id,content,parent_id) VALUES(?,?,?,?)').bind('a','page','답글'+i,id).run();
 const list=await (await s.request('/api/comments?page_id=page')).json() as any;assert.equal(list.data.length,4);assert.equal(list.data[0].reply_count,8);assert.equal(list.data[0].reply_preview_count,3);
 const next=await (await s.request(`/api/comments/${id}/replies?offset=3&limit=3`)).json() as any;assert.equal(next.data.length,3);assert.equal(next.count,8);assert.equal(next.data[0].content,'답글3');
 await s.db.prepare('UPDATE comments SET moderated_at=? WHERE id=?').bind(new Date().toISOString(),id).run();assert.equal((await s.request(`/api/comments/${id}/replies`)).status,404);
 }finally{await s.mf.dispose()}
});
