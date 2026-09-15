import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {ensureBoardSchema} from './ensure-cloudflare-board-schema.mjs';
const env={GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',CLOUDFLARE_ACCOUNT_ID:'90ef0cc5b9fc89e9005b5ca905ae2b6e',CLOUDFLARE_PRODUCTION_D1_ID:'ca03a96c-acb0-4a10-8615-503df3dc5b74',CLOUDFLARE_PRODUCTION_WRITES_APPROVED:'true',CLOUDFLARE_API_TOKEN:'test-only'};
test('board migration rejects wrong targets, missing authorization and changed SQL before network access',async()=>{
  const request=()=>{throw Error('Must not contact a service');};
  for(const change of [{GITHUB_REF:'refs/heads/cloudflare-staging'},{CLOUDFLARE_PRODUCTION_D1_ID:'other'},{CLOUDFLARE_ACCOUNT_ID:'other'},{CLOUDFLARE_PRODUCTION_WRITES_APPROVED:'false'},{GITHUB_ACTIONS:'false'},{CLOUDFLARE_API_TOKEN:''}])await assert.rejects(ensureBoardSchema({...env,...change},request));
  await assert.rejects(ensureBoardSchema(env,request,'DROP TABLE comments;'));
});
test('approved board migration preserves existing comments, is repeatable, and resumes after interrupted bookkeeping',async()=>{
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-08-01',d1Databases:['DB']});
  try{
    const db=await mf.getD1Database('DB');
    for(const sql of ['CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT UNIQUE)','CREATE TABLE comments(id INTEGER PRIMARY KEY,content TEXT)','INSERT INTO comments VALUES(1,\'keep me\')',"INSERT INTO d1_migrations(name) VALUES('0001_initial.sql'),('0002_withdrawal_requests.sql')"])await db.prepare(sql).run();
    const queries=[];let failLedger=true;
    const request=async(url,options)=>{assert.match(url,/\/ca03a96c-acb0-4a10-8615-503df3dc5b74\/query$/);const {sql,params}=JSON.parse(options.body);queries.push(sql);if(failLedger&&sql.startsWith('INSERT')){failLedger=false;return new Response('',{status:503});}const result=await db.prepare(sql).bind(...params).all();return Response.json({success:true,result:[result]});};
    await assert.rejects(ensureBoardSchema(env,request),/503/);
    assert.equal(await ensureBoardSchema(env,request),'verified-existing');
    assert.equal(await ensureBoardSchema(env,request),'verified-existing');
    assert.equal(queries.filter(sql=>sql.startsWith('CREATE')).length,1);
    assert.equal((await db.prepare('SELECT content FROM comments WHERE id=1').first()).content,'keep me');
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM d1_migrations WHERE name='0003_board_pins.sql'").first()).n,1);
    await db.prepare('INSERT INTO board_pins VALUES(1)').run();
    assert.equal(await ensureBoardSchema(env,request),'verified-existing');
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM board_pins').first()).n,1);
    await db.prepare('ALTER TABLE board_pins ADD COLUMN unexpected TEXT').run();
    await assert.rejects(ensureBoardSchema(env,request),/Unexpected board table/);
  }finally{await mf.dispose();}
});
