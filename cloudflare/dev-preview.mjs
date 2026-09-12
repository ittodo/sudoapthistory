// Loopback-only integration preview. Ephemeral DB, fake accounts, outbound HTTP disabled.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, createFetchMock } from 'miniflare';
const bundle = await build({entryPoints:['cloudflare/src/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const mock = createFetchMock();
mock.disableNetConnect();
const runtime = new Miniflare({
  host:'127.0.0.1',port:8795,modules:true,script:bundle.outputFiles[0].text,
  compatibilityDate:'2026-08-01',d1Databases:['DB'],fetchMock:mock,
  bindings:{SITE_ORIGIN:'http://127.0.0.1:8795',RELEASE_SHA:'local-fixture',MAINTENANCE:'false',AUTH_ENABLED:'false'},
  assets:{directory:'cloudflare/dist/public',binding:'ASSETS',routerConfig:{has_user_worker:true,static_routing:{user_worker:['/api/*','/auth/*']}}}
});
const db=await runtime.getD1Database('DB');
const sql=await readFile('cloudflare/migrations/0001_initial.sql','utf8');
for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
const digest=(value)=>createHash('sha256').update(value).digest('hex');
const expires=Math.floor(Date.now()/1000)+3600;
await db.batch([
  db.prepare("INSERT INTO users(id,google_sub,email,role) VALUES('fixture-admin','fake-google-admin','fixture@example.invalid','admin')"),
  db.prepare("INSERT INTO profiles(user_id,nickname) VALUES('fixture-admin','시험관리자')"),
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,authenticated_at,reauthenticated_at) VALUES(?,'fixture-admin',?,?,?)").bind(digest('local-fixture-session'),expires,expires-3600,expires-3600),
  db.prepare("INSERT INTO comments(user_id,page_id,content) VALUES('fixture-admin','home','가상 데이터로 작성한 시험 댓글입니다.')")
]);
console.log('Integration preview: '+await runtime.ready);
console.log('Fake session cookie for test browser only: __Host-nodo_session=local-fixture-session; Path=/; Secure; SameSite=Lax');
const close=async()=>{await runtime.dispose();process.exit(0)};
process.on('SIGINT',close);process.on('SIGTERM',close);
