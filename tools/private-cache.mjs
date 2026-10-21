import {createHash} from 'node:crypto';
// Derived private artifacts only. Source and review databases are never opened here.
import {DatabaseSync} from 'node:sqlite';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {mkdirSync,existsSync,lstatSync,readFileSync,writeFileSync} from 'node:fs';
export function privateCache(root,scope,{database=process.env.NODO_CACHE_DB}={}) {
  const path=resolve(database||join(root,'cloudflare/dist/housing-cache.sqlite'));
  for(let p=dirname(path);p!==dirname(p);p=dirname(p))if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('Symlink private cache path');
  if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('Symlink private cache database');
  mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=3000');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if(tables.length&&!tables.some(t=>['cache_dataset','calculation_cache'].includes(t.name))){db.close();throw Error('Refusing a source database as private cache');}
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL');
  const hash=b=>createHash('sha256').update(b).digest('hex');
  db.exec('CREATE TABLE IF NOT EXISTS calculation_cache(scope TEXT NOT NULL,key TEXT NOT NULL,payload BLOB NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(scope,key))');
  const get=db.prepare('SELECT payload,sha256 FROM calculation_cache WHERE scope=? AND key=?'),put=db.prepare('INSERT INTO calculation_cache VALUES(?,?,?,?) ON CONFLICT(scope,key) DO UPDATE SET payload=excluded.payload,sha256=excluded.sha256 WHERE payload<>excluded.payload OR sha256<>excluded.sha256');
  const has=db.prepare('SELECT 1 FROM calculation_cache WHERE scope=? AND key=?');
  const directory=resolve(root,scope);
  function key(file){const k=relative(directory,resolve(file));if(!k||k==='..'||k.startsWith('../')||k.startsWith('..\\')||isAbsolute(k))throw Error('Cache key outside scope');return k.replaceAll('\\','/');}
  return {path,
    read(file){const row=get.get(scope,key(file));if(!row)throw Error('Cache entry missing');const bytes=Buffer.from(row.payload);if(hash(bytes)!==row.sha256)throw Error('Corrupt private cache entry');return bytes;},
    exists(file){return !!has.get(scope,key(file));},
    write(file,bytes){const data=Buffer.from(bytes);put.run(scope,key(file),data,hash(data));},
    materialize(file,bytes){mkdirSync(dirname(file),{recursive:true});let old;try{old=readFileSync(file);}catch{}if(!old?.equals(bytes))writeFileSync(file,bytes);},
    close(){db.close();},
  };
}
