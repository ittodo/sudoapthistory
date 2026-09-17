import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const migration='0006_page_analytics.sql';
const approvedHash='97612aa0eb364180c790b55ff0a5db2f0f4c75c00b3b3d7a322f30f7ca411653';
const normalize=s=>s.trim().replace(/;$/,'').replace(/\s+/g,' ').toLowerCase();
export async function ensurePageAnalyticsSchema(env=process.env,request=fetch,source=readFileSync(new URL('../cloudflare/migrations/'+migration,import.meta.url),'utf8')){
 assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.GITHUB_REF,'refs/heads/main');
 assert.equal(env.CLOUDFLARE_ACCOUNT_ID,'90ef0cc5b9fc89e9005b5ca905ae2b6e');assert.equal(env.CLOUDFLARE_PRODUCTION_D1_ID,'ca03a96c-acb0-4a10-8615-503df3dc5b74');assert.equal(env.CLOUDFLARE_PRODUCTION_WRITES_APPROVED,'true');assert.ok(env.CLOUDFLARE_API_TOKEN);
 assert.equal(createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex'),approvedHash,'Only reviewed additive page analytics SQL is allowed');
 const query=async(sql,params=[])=>{const response=await request(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${env.CLOUDFLARE_PRODUCTION_D1_ID}/query`,{method:'POST',headers:{Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params}),redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Page analytics schema request failed: '+response.status);const data=await response.json();if(data.success!==true||!data.result?.length||data.result.some(r=>r.success!==true))throw Error('Page analytics schema request rejected');return data.result[0].results;};
 const applied=(await query('SELECT name FROM d1_migrations ORDER BY id')).map(x=>x.name);for(const name of ['0001_initial.sql','0002_withdrawal_requests.sql','0003_board_pins.sql','0004_member_library.sql','0005_admin_audit.sql'])assert.ok(applied.includes(name),'Earlier migration missing');
 for(const sql of source.split(';').map(s=>s.trim()).filter(Boolean)){
  const match=sql.match(/^CREATE (TABLE|INDEX) ([a-z_]+)/);assert.ok(match,'Only additive tables/indexes allowed');
  const [existing]=await query('SELECT sql FROM sqlite_master WHERE type=? AND name=?',[match[1].toLowerCase(),match[2]]);
  if(existing)assert.equal(normalize(existing.sql),normalize(sql),'Incompatible existing object: '+match[2]);else{assert.ok(!applied.includes(migration),'Applied ledger has missing object');await query(sql);}
  const [verified]=await query('SELECT sql FROM sqlite_master WHERE type=? AND name=?',[match[1].toLowerCase(),match[2]]);assert.equal(normalize(verified?.sql||''),normalize(sql));
 }
 if(!applied.includes(migration))await query('INSERT OR IGNORE INTO d1_migrations(name) VALUES (?)',[migration]);
 assert.equal((await query('SELECT name FROM d1_migrations WHERE name=?',[migration])).length,1);return 'verified';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log('Approved page analytics tables: '+await ensurePageAnalyticsSchema());}catch(e){console.error(e.message);process.exitCode=1;}}
