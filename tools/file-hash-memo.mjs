// Process-scoped SHA-256 memo for one validation call. It is not a receipt:
// nothing is persisted, and a scope is opened and closed by its caller.
// A cached digest is used only while the resolved path and the full bigint
// lstat signature (dev, ino, mode, size, ns mtime/ctime) are unchanged. dev+ino
// identify the file, so no realpath call is needed (it costs ~1 ms on Windows).
// Every read is re-checked after hashing. Callers keep their own link checks.
//
// File times have coarse granularity: on NTFS two same-size writes a few ms
// apart often keep identical mtime/ctime. A file whose mtime is within
// RACY_NS of the read start is "racy" (as in Git): its digest is returned but
// never memoized, and callers must not rely on its signature alone later.
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const sha256=b=>createHash('sha256').update(b).digest('hex');
const RACY_NS=2_000_000_000n;
let depth=0,entries=null;
export const hashScopeStats={hits:0,misses:0,racy:0,bytes:0};
export function fileSignature(s){return [s.dev,s.ino,s.mode,s.size,s.mtimeNs,s.ctimeNs].join(':');}
export function beginHashScope(){if(depth++===0){entries=new Map();Object.assign(hashScopeStats,{hits:0,misses:0,racy:0,bytes:0});}}
export function endHashScope(){if(depth===0)throw Error('Hash scope is not open');if(--depth===0)entries=null;}
export function hashScopeOpen(){return depth>0;}
function state(path){const s=lstatSync(path,{bigint:true});if(!s.isFile())throw Error('Hashed source is not a regular file: '+path);return s;}
// `onRead` is a test seam that runs between the read and the second lstat.
function load(path,{bytes:keepBytes=false,onRead=null}={}){
 const real=resolve(path),before=state(real),signature=fileSignature(before),key=real+'|'+signature,hit=entries?.get(key);
 if(hit&&!keepBytes){hashScopeStats.hits++;return hit;}
 const started=BigInt(Date.now())*1_000_000n,bytes=readFileSync(real);onRead?.(real);
 const after=state(real);
 if(fileSignature(after)!==signature||BigInt(bytes.length)!==after.size)throw Error('Source changed during hashing: '+path);
 let value=hit;
 if(value)hashScopeStats.hits++;
 else{
  const racy=after.mtimeNs+RACY_NS>=started;
  value={digest:sha256(bytes),size:bytes.length,signature,racy};hashScopeStats.misses++;hashScopeStats.bytes+=bytes.length;
  if(racy)hashScopeStats.racy++;else entries?.set(key,value);
 }
 return keepBytes?{...value,bytes}:value;
}
// Digest only. Inside a scope an unchanged, non-racy file is not read again.
export function hashFile(path,options={}){return load(path,{...options,bytes:false});}
// Bytes are always read. A memo hit skips only the repeated digest.
export function readHashed(path,options={}){return load(path,{...options,bytes:true});}
