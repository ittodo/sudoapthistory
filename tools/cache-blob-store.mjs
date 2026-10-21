// Content storage for private cache entries. No source or public data belongs here.
import {createHash} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';

export const hash=b=>createHash('sha256').update(b).digest('hex');
export const artifactSchema=`
CREATE TABLE IF NOT EXISTS cache_blob(
 sha256 TEXT PRIMARY KEY,byte_length INTEGER NOT NULL CHECK(byte_length>=0),
 codec INTEGER NOT NULL CHECK(codec IN (0,1)),payload BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS cache_artifact(
 scope TEXT NOT NULL,key TEXT NOT NULL,parent TEXT NOT NULL,
 kind INTEGER NOT NULL CHECK(kind IN (0,1)),sha256 TEXT NOT NULL,
 byte_length INTEGER NOT NULL CHECK(byte_length>=0),modified_ns INTEGER NOT NULL,
 PRIMARY KEY(scope,key));
CREATE INDEX IF NOT EXISTS cache_artifact_parent ON cache_artifact(scope,parent);
CREATE INDEX IF NOT EXISTS cache_artifact_blob ON cache_artifact(sha256) WHERE kind=0;
CREATE TRIGGER IF NOT EXISTS cache_artifact_remove_blob AFTER DELETE ON cache_artifact WHEN OLD.kind=0 BEGIN
 DELETE FROM cache_blob WHERE sha256=OLD.sha256 AND NOT EXISTS(SELECT 1 FROM cache_artifact WHERE kind=0 AND sha256=OLD.sha256);
END;
CREATE TRIGGER IF NOT EXISTS cache_artifact_replace_blob AFTER UPDATE OF sha256,kind ON cache_artifact WHEN OLD.kind=0 AND (OLD.sha256!=NEW.sha256 OR NEW.kind!=0) BEGIN
 DELETE FROM cache_blob WHERE sha256=OLD.sha256 AND NOT EXISTS(SELECT 1 FROM cache_artifact WHERE kind=0 AND sha256=OLD.sha256);
END;`;
const statements=new WeakMap();
export function statement(c,sql){let m=statements.get(c);if(!m){m=new Map();statements.set(c,m);}let s=m.get(sql);if(!s){s=c.prepare(sql);m.set(sql,s);}return s;}
export function ensureArtifactSchema(c){
 if(c.prepare('PRAGMA table_info(cache_artifact)').all().some(r=>r.name==='payload'))throw Error('Private cache v1 requires explicit compaction before use');
 c.exec(artifactSchema);
}
export function encodeBlob(bytes){
 const raw=Buffer.from(bytes);
 // Recompressing existing gzip assets adds CPU without useful size savings.
 if(raw.length>=256&&!(raw[0]===31&&raw[1]===139)){
  const packed=deflateRawSync(raw,{level:1});if(packed.length+32<raw.length)return{codec:1,payload:packed};
 }
 return{codec:0,payload:raw};
}
export function decodeBlob(row){
 if(!row||!Number.isSafeInteger(Number(row.byte_length))||row.byte_length<0)throw Error('Private cache artifact corrupt: missing blob');
 const bytes=row.codec===0?Buffer.from(row.payload):row.codec===1?inflateRawSync(row.payload,{maxOutputLength:Math.max(1,Number(row.byte_length))}):null;
 if(!bytes||bytes.length!==Number(row.byte_length)||hash(bytes)!==row.sha256)throw Error('Private cache artifact corrupt');
 return bytes;
}
export function readArtifact(c,scope,key){
 const row=statement(c,'SELECT a.kind,a.sha256,a.byte_length,b.codec,b.payload FROM cache_artifact a LEFT JOIN cache_blob b ON b.sha256=a.sha256 WHERE a.scope=? AND a.key=?').get(scope,key);
 if(!row)return null;if(row.kind!==0)throw Error('Private cache artifact is not a file');return decodeBlob(row);
}
export function putArtifact(c,scope,key,kind,bytes,modified=BigInt(Date.now())*1000000n){
 const raw=Buffer.from(bytes),digest=kind===0?hash(raw):'',length=kind===0?raw.length:0,parent=key.includes('/')?key.slice(0,key.lastIndexOf('/')):'';
 c.exec('SAVEPOINT cache_put');
 try{
  if(kind===0&&!statement(c,'SELECT 1 FROM cache_blob WHERE sha256=?').get(digest)){
   const encoded=encodeBlob(raw);statement(c,'INSERT INTO cache_blob(sha256,byte_length,codec,payload) VALUES(?,?,?,?)').run(digest,length,encoded.codec,encoded.payload);
  }
  statement(c,'INSERT INTO cache_artifact(scope,key,parent,kind,sha256,byte_length,modified_ns) VALUES(?,?,?,?,?,?,?) ON CONFLICT(scope,key) DO UPDATE SET parent=excluded.parent,kind=excluded.kind,sha256=excluded.sha256,byte_length=excluded.byte_length,modified_ns=excluded.modified_ns WHERE kind!=excluded.kind OR sha256!=excluded.sha256 OR byte_length!=excluded.byte_length').run(scope,key,parent,kind,digest,length,modified);
  c.exec('RELEASE cache_put');return digest;
 }catch(e){c.exec('ROLLBACK TO cache_put; RELEASE cache_put');throw e;}
}
