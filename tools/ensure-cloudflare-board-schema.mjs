import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// User authorized this single additive production migration on 2026-09-15.
// No general migration runner, member updates, or table recreation is allowed here.
const account='90ef0cc5b9fc89e9005b5ca905ae2b6e';
const database='ca03a96c-acb0-4a10-8615-503df3dc5b74';
const migration='0003_board_pins.sql';
const ddl='CREATE TABLE board_pins (comment_id INTEGER PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE);';

export async function ensureBoardSchema(env=process.env,request=fetch,source=readFileSync(new URL('../cloudflare/migrations/'+migration,import.meta.url),'utf8')){
  assert.equal(env.GITHUB_ACTIONS,'true');
  assert.equal(env.GITHUB_REF,'refs/heads/main');
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID,account);
  assert.equal(env.CLOUDFLARE_PRODUCTION_D1_ID,database);
  assert.equal(env.CLOUDFLARE_PRODUCTION_WRITES_APPROVED,'true');
  assert.ok(env.CLOUDFLARE_API_TOKEN);
  assert.equal(source.trim(),ddl,'Only the reviewed board table SQL is authorized');
  const query=async(sql,params=[])=>{
    const response=await request(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,{
      method:'POST',headers:{Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},
      body:JSON.stringify({sql,params}),redirect:'error',signal:AbortSignal.timeout(30000)
    });
    if(!response.ok)throw Error('Production board schema request failed: HTTP '+response.status);
    const data=await response.json();
    if(data.success!==true||!data.result?.length||data.result.some(r=>r.success!==true))throw Error('Production board schema query rejected');
    return data.result[0].results;
  };
  const applied=(await query('SELECT name FROM d1_migrations ORDER BY id')).map(r=>r.name);
  for(const name of ['0001_initial.sql','0002_withdrawal_requests.sql'])assert.ok(applied.includes(name),'Existing production migrations must already be applied');
  const exists=(await query("SELECT name FROM sqlite_master WHERE type='table' AND name='board_pins'")).length>0;
  if(!exists){
    assert.ok(!applied.includes(migration),'Migration ledger and table disagree; refusing repair');
    await query(ddl);
  }
  const columns=await query('PRAGMA table_info(board_pins)');
  assert.equal(columns.length,1,'Unexpected board table columns');
  assert.equal(columns[0].name,'comment_id');assert.equal(columns[0].type.toUpperCase(),'INTEGER');assert.equal(columns[0].pk,1);
  const keys=await query('PRAGMA foreign_key_list(board_pins)');
  assert.equal(keys.length,1,'Unexpected board table relation');
  assert.equal(keys[0].table,'comments');assert.equal(keys[0].from,'comment_id');assert.equal(keys[0].to,'id');assert.equal(keys[0].on_delete,'CASCADE');
  if(!applied.includes(migration))await query('INSERT OR IGNORE INTO d1_migrations(name) VALUES (?)',[migration]);
  assert.equal((await query('SELECT name FROM d1_migrations WHERE name=?',[migration])).length,1);
  return exists?'verified-existing':'created';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log('Approved production board table: '+await ensureBoardSchema());}
  catch(error){console.error(error.message);process.exitCode=1;}
}
