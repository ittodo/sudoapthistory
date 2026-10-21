import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as disk from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import * as cache from './cache-store.mjs';
test('private artifacts use SQLite; old files cannot satisfy a cache miss',()=>{
 const root=disk.mkdtempSync(join(tmpdir(),'housing-cache-store-')),directory=join(root,'_ops/regional-transaction-cache/baseline/current');
 try{
  disk.mkdirSync(directory,{recursive:true});disk.writeFileSync(join(directory,'old.bin'),'obsolete');assert.equal(cache.existsSync(join(directory,'old.bin')),false);
  cache.mkdirSync(directory,{recursive:true});cache.writeFileSync(join(directory,'result.tmp'),'exact bytes');cache.renameSync(join(directory,'result.tmp'),join(directory,'result.bin'));
  assert.equal(disk.existsSync(join(directory,'result.bin')),false);assert.equal(cache.existsSync(join(directory,'result.tmp')),false);assert.equal(cache.readFileSync(join(directory,'result.bin'),'utf8'),'exact bytes');
  assert.deepEqual(cache.readdirSync(directory),['result.bin']);assert.equal(cache.lstatSync(directory).isDirectory(),true);
  const output=join(root,'public.bin');cache.copyFileSync(join(directory,'result.bin'),output);assert.equal(disk.readFileSync(output,'utf8'),'exact bytes');
  cache.renameSync(join(directory,'result.bin'),join(directory,'result.bin'));assert.equal(cache.readFileSync(join(directory,'result.bin'),'utf8'),'exact bytes');
  const db=new DatabaseSync(join(root,'data/housing-cache.sqlite'));db.prepare("UPDATE cache_blob SET payload=x'00' WHERE sha256=(SELECT sha256 FROM cache_artifact WHERE key=?)").run('baseline/current/result.bin');db.close();assert.throws(()=>cache.readFileSync(join(directory,'result.bin')),/corrupt/);
 }finally{cache.closeCacheStores();assert.equal(resolve(root,'..'),resolve(tmpdir()));disk.rmSync(root,{recursive:true,force:true});}
});

test('identical paths share one compressed payload; replacement retains other readers',()=>{
 const root=disk.mkdtempSync(join(tmpdir(),'housing-cache-dedup-')),directory=join(root,'_ops/regional-transaction-cache/baseline/current');
 try{
  cache.mkdirSync(directory,{recursive:true});const text='같은 자료를 여러 경로에서 참조합니다.\n'.repeat(3000);
  for(const name of ['a','b','c'])cache.writeFileSync(join(directory,name),text);
  const db=new DatabaseSync(join(root,'data/housing-cache.sqlite'));
  assert.equal(db.prepare('SELECT count(*) n FROM cache_blob').get().n,1);
  assert.ok(db.prepare('SELECT sum(length(payload)) n FROM cache_blob').get().n<Buffer.byteLength(text)/4);
  cache.writeFileSync(join(directory,'a'),'changed');assert.equal(cache.readFileSync(join(directory,'b'),'utf8'),text);
  cache.unlinkSync(join(directory,'b'));cache.renameSync(join(directory,'c'),join(directory,'a'));
  assert.equal(cache.readFileSync(join(directory,'a'),'utf8'),text);assert.equal(db.prepare('SELECT count(*) n FROM cache_blob').get().n,1);
  cache.unlinkSync(join(directory,'a'));assert.equal(db.prepare('SELECT count(*) n FROM cache_blob').get().n,0);db.close();
 }finally{cache.closeCacheStores();disk.rmSync(root,{recursive:true,force:true});}
});
