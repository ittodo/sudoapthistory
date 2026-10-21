import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,realpathSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {privateCache} from './private-cache.mjs';
test('derived cache shares a database, detects corruption and restores output without source access',()=>{
 const root=mkdtempSync(join(tmpdir(),'housing-private-cache-'));
 try {
  const a=privateCache(root,'first'),file=join(root,'first/value.bin');a.write(file,'one');a.close();
  const b=privateCache(root,'second');b.write(join(root,'second/value.bin'),'two');b.close();
  const warm=privateCache(root,'first');assert.equal(warm.read(file).toString(),'one');assert.throws(()=>warm.read(join(root,'outside')),/outside scope/);
  warm.materialize(file,warm.read(file));writeFileSync(file,'corrupt output');warm.materialize(file,warm.read(file));assert.equal(readFileSync(file,'utf8'),'one');warm.close();
  const db=new DatabaseSync(join(root,'cloudflare/dist/housing-cache.sqlite'));db.exec("UPDATE calculation_cache SET sha256='corrupt' WHERE scope='first'");db.close();
  const repair=privateCache(root,'first');assert.throws(()=>repair.read(file),/Corrupt/);repair.write(file,'one');assert.equal(repair.read(file).toString(),'one');repair.close();
  const source=join(root,'source.sqlite'),s=new DatabaseSync(source);s.exec("CREATE TABLE original(value TEXT);INSERT INTO original VALUES('preserve')");s.close();
  const before=readFileSync(source);assert.throws(()=>privateCache(root,'source',{database:source}),/Refusing/);assert.deepEqual(readFileSync(source),before);
 } finally {const p=realpathSync(root),parent=realpathSync(tmpdir());if(!p.startsWith(parent+sep)||!p.slice(parent.length+1).startsWith('housing-private-cache-'))throw Error('Unsafe cleanup');rmSync(p,{recursive:true});}
});
