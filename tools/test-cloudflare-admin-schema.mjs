import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {ensureAdminAuditSchema} from './ensure-cloudflare-admin-schema.mjs';
const env={GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',CLOUDFLARE_ACCOUNT_ID:'90ef0cc5b9fc89e9005b5ca905ae2b6e',CLOUDFLARE_PRODUCTION_D1_ID:'ca03a96c-acb0-4a10-8615-503df3dc5b74',CLOUDFLARE_PRODUCTION_WRITES_APPROVED:'true',CLOUDFLARE_API_TOKEN:'test-only'};
test('admin audit migration rejects wrong targets and unreviewed SQL',async()=>{
 const no=()=>{throw Error('No network');};for(const change of [{GITHUB_REF:'refs/heads/other'},{CLOUDFLARE_PRODUCTION_D1_ID:'other'},{CLOUDFLARE_PRODUCTION_WRITES_APPROVED:'false'}])await assert.rejects(ensureAdminAuditSchema({...env,...change},no));await assert.rejects(ensureAdminAuditSchema(env,no,'DROP TABLE users;'));
});
test('admin audit migration is additive, resumable and detects incompatible schemas',async()=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-08-01',d1Databases:['DB']});
 try{const db=await mf.getD1Database('DB');for(const sql of ['CREATE TABLE users(id TEXT PRIMARY KEY)','CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE)',"INSERT INTO users VALUES('keep')","INSERT INTO d1_migrations(name) VALUES('0001_initial.sql'),('0002_withdrawal_requests.sql'),('0003_board_pins.sql'),('0004_member_library.sql')"])await db.prepare(sql).run();let fail=true;const request=async(url,options)=>{assert.ok(url.endsWith('/ca03a96c-acb0-4a10-8615-503df3dc5b74/query'));const {sql,params}=JSON.parse(options.body);if(sql.startsWith('INSERT OR IGNORE INTO d1_migrations')&&fail){fail=false;return new Response('',{status:503});}return Response.json({success:true,result:[await db.prepare(sql).bind(...params).all()]});};await assert.rejects(ensureAdminAuditSchema(env,request),/503/);assert.equal(await ensureAdminAuditSchema(env,request),'verified');assert.equal(await ensureAdminAuditSchema(env,request),'verified');assert.equal((await db.prepare('SELECT id FROM users').first()).id,'keep');await db.prepare('ALTER TABLE admin_audit_log ADD COLUMN unexpected TEXT').run();await assert.rejects(ensureAdminAuditSchema(env,request),/Incompatible/);
 }finally{await mf.dispose();}
});
