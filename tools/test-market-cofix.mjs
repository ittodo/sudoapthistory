import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {parseYear,validate,collect} from './collect-cofix.mjs';
const source='https://portal.kfb.or.kr/fingoods/cofix.php';
const html=(date,month,a='3.18',b='3.05',c='2.71')=>`<table><tr>${[date,month,a,b,c].map(v=>'<td>'+v+'</td>').join('')}</tr></table>`;
test('official monthly table ignores weekly rows and preserves pre-launch null',()=>{const rows=parseYear(html('2010/02/16','2010/01','3.88','4.11','')+html('2010/02/16','2010/02/09','3','4',''),2010);assert.equal(rows.length,1);assert.equal(rows[0].newBalance,null);assert.equal(rows[0].month,'2010-01');});
test('rejects gaps, duplicate months, invalid/missing rates and future publication',()=>{const row=parseYear(html('2026/09/15','2026/08'),2026)[0],data={schema:1,source,rows:[row]};assert.equal(validate(data,'2026-10-01'),data);for(const rows of [[row,row],[row,{...row,month:'2026-10',publishedAt:'2026-11-15'}],[{...row,new:null}],[{...row,newBalance:null}],[{...row,publishedAt:'2026-09-31'}]])assert.throws(()=>validate({...data,rows},'2026-10-01'));});
test('failed/incomplete refresh leaves last normal bytes unchanged',async()=>{const p=join(mkdtempSync(join(tmpdir(),'cofix-test-')),'cofix.json'),data={schema:1,source,rows:[parseYear(html('2026/09/15','2026/08'),2026)[0]]};writeFileSync(p,JSON.stringify(data));const bytes=readFileSync(p);await assert.rejects(collect({output:p,today:'2026-10-01',fetcher:async()=>{throw Error('network');}}));assert.deepEqual(readFileSync(p),bytes);await assert.rejects(collect({output:p,today:'2026-10-01',fetcher:async()=>new Response('<html>unavailable</html>')}));assert.deepEqual(readFileSync(p),bytes);});
test('aligns exact target month for both graphs without filling missing months',()=>{const context={window:{}};vm.runInNewContext(readFileSync(new URL('../js/market-cofix.js',import.meta.url),'utf8'),context);const M=context.window.NodoMarketCofix;assert.deepEqual(Array.from(M.series([{month:'2026-08',new:3.18}],['2026.07','2026.08','2026.09'],'new')),[null,3.18,null]);assert.deepEqual(Array.from(M.series([{month:'2010-01',newBalance:null}],['2010-01'],'newBalance')),[null]);});

test('refresh accepts official corrections and repeated input changes zero bytes',async()=>{
 const p=join(mkdtempSync(join(tmpdir(),'cofix-correction-')),'cofix.json');
 const rows=[parseYear(html('2025/12/15','2025/11'),2025)[0],parseYear(html('2026/01/15','2025/12'),2026)[0]];
 writeFileSync(p,JSON.stringify({schema:1,source,rows}));
 const fetcher=async url=>new Response(url.endsWith('2025')?html('2025/12/15','2025/11','3.20'):html('2026/01/15','2025/12'));
 assert.equal((await collect({output:p,today:'2026-01-20',fetcher})).status,'UPDATED');
 assert.equal(JSON.parse(readFileSync(p)).rows[0].new,3.20);
 const bytes=readFileSync(p);assert.equal((await collect({output:p,today:'2026-01-21',fetcher})).status,'UNCHANGED');assert.deepEqual(readFileSync(p),bytes);
 assert.throws(()=>parseYear(html('2026/01/15','2025/12')+html('2026/01/15','2025/12'),2026),/Duplicate/);
});
test('packaging blocks absent or corrupt fallback COFIX before building housing assets',async()=>{
 const {build}=await import('./build-cloudflare-assets.mjs');const {mkdirSync}=await import('node:fs');
 const root=mkdtempSync(join(tmpdir(),'cofix-build-'));mkdirSync(join(root,'js'));writeFileSync(join(root,'js/market-cofix.js'),'');
 assert.throws(()=>build(root,join(root,'cloudflare/dist/public'),'a'.repeat(40)),/ENOENT/);
 mkdirSync(join(root,'data/market-rates'),{recursive:true});writeFileSync(join(root,'data/market-rates/cofix.json'),'{}');
 assert.throws(()=>build(root,join(root,'cloudflare/dist/public'),'a'.repeat(40)),/Invalid COFIX dataset/);
});
