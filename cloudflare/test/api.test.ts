import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,createFetchMock} from 'miniflare';

const origin='https://test.example';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const bundle=await build({entryPoints:['cloudflare/src/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const sql=await readFile('cloudflare/migrations/0001_initial.sql','utf8');
async function setup(maintenance=false){
 const mock=createFetchMock();mock.disableNetConnect();
 const options={modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-01',d1Databases:['DB'],bindings:{SITE_ORIGIN:origin,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'fake-secret',RELEASE_SHA:'abc123',MAINTENANCE:String(maintenance),AUTH_ENABLED:'true'},serviceBindings:{ASSETS:()=>new Response('asset',{status:404})},fetchMock:mock};
 const mf=new Miniflare(options);
 const db=await mf.getD1Database('DB');for(const s of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(s).run();
 async function user(id:string,role='user',age=0){const raw='session-token-'+id;await db.batch([db.prepare('INSERT INTO users(id,google_sub,email,role) VALUES(?,?,?,?)').bind(id,'google-'+id,id+'@example.test',role),db.prepare('INSERT INTO profiles(user_id,nickname) VALUES(?,?)').bind(id,'닉네임'+id),db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,authenticated_at,reauthenticated_at) VALUES(?,?,?,?,?)').bind(digest(raw),id,Math.floor(Date.now()/1000)+604800,Math.floor(Date.now()/1000)-age,Math.floor(Date.now()/1000)-age)]);return {Cookie:'__Host-nodo_session='+raw,'X-CSRF-Token':digest('csrf:'+raw),Origin:origin}}
 async function request(path:string,method='GET',data?:unknown,headers:Record<string,string>={}){return mf.dispatchFetch(origin+path,{method,redirect:'manual',headers:{...headers,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)})}
 return {mf,db,user,request,mock,options};
}
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
 assert.equal((await s.request('/api/account','DELETE',undefined,a)).status,200);
 assert.equal((await s.db.prepare('SELECT content FROM comments WHERE id=?').bind(replyId).first() as any).content,'답글');
 assert.equal((await s.db.prepare('SELECT content FROM comments WHERE id=?').bind(root).first() as any).content,'');
 assert.equal(await s.db.prepare('SELECT * FROM users WHERE id=?').bind('a').first(),null);
 assert.deepEqual((await (await s.request('/api/comments?page_id=test')).json() as any).data,[]);
 }finally{await s.mf.dispose()}
});
test('tags atomic and idempotent, direction change, account cascade and quota boundaries',async()=>{
 const s=await setup();try{const a=await s.user('a');
 for(let i=0;i<20;i++){const response=await s.request('/api/stocks/005930/tags','POST',{name:'태그'+i},a);assert.equal(response.status,201,await response.text());}
 assert.equal((await s.request('/api/stocks/005930/tags','POST',{name:'초과'},a)).status,429);
 const tags=await (await s.request('/api/stocks/005930/tags','GET',undefined,a)).json() as any;assert.equal(tags.data.length,20);const id=tags.data[0].tag_id;
 for(const vote of ['down','down','up',null])assert.equal((await s.request('/api/tags/'+id+'/vote','PUT',{vote},a)).status,200);
 assert.equal(await s.db.prepare('SELECT * FROM tag_votes WHERE tag_id=?').bind(id).first(),null);
 await s.request('/api/account','DELETE',undefined,a);assert.equal((await s.db.prepare('SELECT count(*) n FROM tags').first() as any).n,20);assert.equal((await s.db.prepare('SELECT count(*) n FROM tag_votes').first() as any).n,0);
 }finally{await s.mf.dispose()}
});
test('30 writes per minute, body limits, expired sessions, maintenance and no-store 404',async()=>{
 const s=await setup();try{const a=await s.user('a'),old=await s.user('old','user',601);assert.equal((await s.request('/api/account','DELETE',undefined,old)).status,403);
 assert.equal((await s.request('/api/profile','PATCH',{nickname:'x'.repeat(20000)},a)).status,413);
 for(let i=0;i<29;i++)assert.equal((await s.request('/api/profile','PATCH',{nickname:'테스트'},a)).status,200);
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
 async function flow(change:Record<string,unknown>={},badSignature=false,reauthCookie?:string){
  const start=await s.request('/auth/google?returnTo=%2Faccount%2F'+(reauthCookie?'&reauth=1':''),'GET',undefined,reauthCookie?{Cookie:reauthCookie}:{});assert.equal(start.status,302);assert.equal(start.headers.get('referrer-policy'),'no-referrer');const dest=new URL(start.headers.get('location')!);assert.equal(dest.searchParams.get('code_challenge_method'),'S256');assert.ok(dest.searchParams.get('code_challenge'));if(reauthCookie)assert.equal(dest.searchParams.get('prompt'),'select_account');
  const state=dest.searchParams.get('state')!,nonce=dest.searchParams.get('nonce')!;const n=Math.floor(Date.now()/1000);const payload={iss:'https://accounts.google.com',aud:'test-client',sub:'new-google-id',email:'new@example.test',email_verified:true,iat:n,exp:n+300,nonce,...change};
  const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url'),data=Buffer.from(JSON.stringify(payload)).toString('base64url');const signing=head+'.'+data;const signature=badSignature?Buffer.alloc(256):sign('RSA-SHA256',Buffer.from(signing),privateKey);const jwt=signing+'.'+signature.toString('base64url');
  s.mock.get('https://oauth2.googleapis.com').intercept({path:'/token',method:'POST'}).reply(200,{access_token:'fake',token_type:'Bearer',id_token:jwt},{headers:{'content-type':'application/json'}});
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
 const start=await s.request('/auth/google');const state=new URL(start.headers.get('location')!).searchParams.get('state')!;await s.db.prepare('UPDATE oauth_states SET expires_at=0').run();assert.equal((await s.request('/auth/callback?code=fake&state='+state,'GET',undefined,{Cookie:'__Host-nodo_oauth='+state})).status,400);
 assert.equal((await s.request('/auth/callback?state=wrong','GET',undefined,{Cookie:'__Host-nodo_oauth=other'})).status,400);
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
