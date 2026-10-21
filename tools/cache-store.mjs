// Shared local artifact store. Paths below the approved private roots are keys.
// Public assets, source files and run logs continue to use the real filesystem.
import * as disk from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {resolve,join,dirname,basename,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {artifactSchema,ensureArtifactSchema,putArtifact,readArtifact} from './cache-blob-store.mjs';
import {Readable} from 'node:stream';
const databases=new Map();
function pathName(p){return p instanceof URL?fileURLToPath(p):String(p);}
function address(p){
 const raw=pathName(p);
 const path=resolve(raw),s=path.replaceAll('\\','/'),local=/^(.*)\/_ops\/(regional-transaction-cache|validation-cache-v1|daily-rust-cache|rental-rust-cache|rental-catalog-metadata-v1|generation-cache)(?:\/(.*))?$/.exec(s),ci=/^(.*)\/cloudflare\/dist\/(validation-cache-v1)(?:\/(.*))?$/.exec(s),match=local||ci;
 if(!match)return null;if(raw.replaceAll('\\','/').split('/').includes('..'))throw Error('Parent traversal in cache path');const root=match[1],scope=match[2],key=match[3]||'';
 if(key.includes(':')||key.split('/').some(p=>p==='.'||p==='..'))throw Error('Invalid private cache key');
 return{path,root,scope,key,base:join(root,local?'_ops':'cloudflare/dist',scope),database:join(root,local?'data/housing-cache.sqlite':'cloudflare/dist/housing-cache.sqlite')};
}
function db(a){
 let c=databases.get(a.database);if(c)return c;
 for(let p=a.database;;p=dirname(p)){if(disk.existsSync(p)&&disk.lstatSync(p).isSymbolicLink())throw Error('Private cache database link');if(dirname(p)===p)break;}
 disk.mkdirSync(dirname(a.database),{recursive:true});c=new DatabaseSync(a.database);c.exec('PRAGMA busy_timeout=30000');
 if(c.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('transactions','hub_entity','link','review') LIMIT 1").get()){c.close();throw Error('Refusing source or review database as cache');}
 try{ensureArtifactSchema(c);c.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');}catch(e){c.close();throw e;}databases.set(a.database,c);return c;
}
function fail(path,code='ENOENT'){const e=new Error(`Private cache ${code}: ${path}`);e.code=code;throw e;}
function put(a,kind,bytes){return putArtifact(db(a),a.scope,a.key,kind,bytes);}
export function isCachedPath(p){return !!address(p);}
export function readFileSync(p,options){const a=address(p);if(!a)return disk.readFileSync(p,options);const bytes=readArtifact(db(a),a.scope,a.key);if(!bytes)fail(p);const encoding=typeof options==='string'?options:options?.encoding;return encoding?bytes.toString(encoding):bytes;}
export function writeFileSync(p,data,options){const a=address(p);if(!a)return disk.writeFileSync(p,data,options);if(options?.flag?.includes('x')&&existsSync(p))fail(p,'EEXIST');put(a,0,typeof data==='string'?Buffer.from(data,typeof options==='string'?options:options?.encoding):data);}
export function mkdirSync(p,options){const a=address(p);if(!a)return disk.mkdirSync(p,options);const segments=a.key.split('/').filter(Boolean);for(let n=0;n<=segments.length;n++){const key=segments.slice(0,n).join('/'),prior=db(a).prepare('SELECT kind FROM cache_artifact WHERE scope=? AND key=?').get(a.scope,key);if(prior&&prior.kind!==1)fail(p,'ENOTDIR');if(!prior)put({...a,key},1,Buffer.alloc(0));}}
export function lstatSync(p,options){const a=address(p);if(!a)return disk.lstatSync(p,options);const stmt=db(a).prepare('SELECT rowid,kind,byte_length size,modified_ns FROM cache_artifact WHERE scope=? AND key=?');stmt.setReadBigInts(true);const r=stmt.get(a.scope,a.key);if(!r)fail(p);const ms=Number(r.modified_ns)/1e6,n=x=>options?.bigint?x:Number(x);return{dev:n(0n),ino:n(r.rowid),mode:n(r.kind===0n?32768n:16384n),size:n(r.size),mtimeMs:ms,ctimeMs:ms,birthtimeMs:ms,mtimeNs:r.modified_ns,ctimeNs:r.modified_ns,mtime:new Date(ms),ctime:new Date(ms),birthtime:new Date(ms),isFile:()=>r.kind===0n,isDirectory:()=>r.kind===1n,isSymbolicLink:()=>false};}
export function statSync(p,options){return address(p)?lstatSync(p,options):disk.statSync(p,options);}
export function existsSync(p){try{lstatSync(p);return true;}catch(e){if(e.code==='ENOENT'||e.code==='ENOTDIR')return false;throw e;}}
export function realpathSync(p,options){const a=address(p);if(!a)return disk.realpathSync(p,options);lstatSync(p);const root=disk.realpathSync(a.root),path=join(root,relative(a.root,a.base),a.key);return options==='buffer'||options?.encoding==='buffer'?Buffer.from(path):path;}
export function renameSync(from,to){const a=address(from),b=address(to);if(!a&&!b)return disk.renameSync(from,to);if(!a||!b||a.database!==b.database||a.scope!==b.scope)throw Error('Cross-store cache rename unsupported');if(a.key===b.key){lstatSync(from);return;}const c=db(a);c.exec('SAVEPOINT cache_rename');try{const row=c.prepare('SELECT kind,sha256,byte_length,modified_ns FROM cache_artifact WHERE scope=? AND key=?');row.setReadBigInts(true);const r=row.get(a.scope,a.key);if(!r)fail(from);if(r.kind!==0n)fail(from,'EISDIR');c.prepare('INSERT INTO cache_artifact(scope,key,parent,kind,sha256,byte_length,modified_ns) VALUES(?,?,?,?,?,?,?) ON CONFLICT(scope,key) DO UPDATE SET kind=excluded.kind,sha256=excluded.sha256,byte_length=excluded.byte_length,modified_ns=excluded.modified_ns').run(b.scope,b.key,b.key.includes('/')?b.key.slice(0,b.key.lastIndexOf('/')):'',r.kind,r.sha256,r.byte_length,r.modified_ns);c.prepare('DELETE FROM cache_artifact WHERE scope=? AND key=?').run(a.scope,a.key);c.exec('RELEASE cache_rename');}catch(e){c.exec('ROLLBACK TO cache_rename; RELEASE cache_rename');throw e;}}
export function unlinkSync(p){const a=address(p);if(!a)return disk.unlinkSync(p);if(!db(a).prepare('DELETE FROM cache_artifact WHERE scope=? AND key=? AND kind=0').run(a.scope,a.key).changes)fail(p);}
export function copyFileSync(from,to,mode){if(!address(from)&&!address(to))return disk.copyFileSync(from,to,mode);if(mode===disk.constants.COPYFILE_EXCL&&existsSync(to))fail(to,'EEXIST');writeFileSync(to,readFileSync(from));}
export function readdirSync(p,options){const a=address(p);if(!a)return disk.readdirSync(p,options);if(!lstatSync(p).isDirectory())fail(p,'ENOTDIR');return db(a).prepare('SELECT key,kind FROM cache_artifact WHERE scope=? AND parent=? AND key!=? ORDER BY key').all(a.scope,a.key,a.key).map(r=>options?.withFileTypes?{name:basename(r.key),parentPath:pathName(p),isFile:()=>r.kind===0,isDirectory:()=>r.kind===1,isSymbolicLink:()=>false}:basename(r.key));}
export function createReadStream(p,options){const a=address(p);if(!a)return disk.createReadStream(p,options);const bytes=readFileSync(p);return Readable.from([bytes.subarray(options?.start||0,options?.end===undefined?undefined:options.end+1)]);}
export function rmSync(p,options){const a=address(p);if(!a)return disk.rmSync(p,options);if(!a.key)throw Error('Refusing cache namespace removal');const c=db(a);if(!options?.recursive){if(lstatSync(p).isDirectory())fail(p,'EISDIR');return unlinkSync(p);}c.prepare('DELETE FROM cache_artifact WHERE scope=? AND (key=? OR substr(key,1,?)=?)').run(a.scope,a.key,a.key.length+1,a.key+'/');}
export function closeCacheStores(){for(const c of databases.values())c.close();databases.clear();}
// CI persists the main database file after this process. Closing the final
// connection checkpoints SQLite's WAL before actions/cache archives that file.
process.once('exit',closeCacheStores);
export {constants} from 'node:fs';
export {artifactSchema};
