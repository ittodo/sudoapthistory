import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {privateCache} from './private-cache.mjs';

export const FORMAT='gzip-json-records-v1';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Encoding changes invalidate transport bytes, without invalidating calculations.
const codec=hash(readFileSync(new URL('./packed-asset-cache.mjs',import.meta.url)));
export function packedAssetSet(root,prefix,entries,{buckets=32,stats={}}={}){
 if(!/^data(?:\/[a-z0-9-]+)+$/.test(prefix)||!Number.isInteger(buckets)||buckets<1||buckets>256)throw Error('Invalid packed asset scope');
 const groups=Array.from({length:buckets},()=>[]),seen=new Set();
 for(const [key,value]of entries){if(typeof key!=='string'||seen.has(key))throw Error('Invalid packed record key');seen.add(key);groups[parseInt(hash(key).slice(0,2),16)%buckets].push([key,value]);}
 const scope='cloudflare/dist/packed-transport/'+prefix,cache=privateCache(root,scope),assets=[],sources={},rawBytes={};
 stats.encoded=0;stats.reused=0;
 try{for(let i=0;i<buckets;i++){
  const group=groups[i].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),bucket=i.toString(16).padStart(2,'0'),key=join(root,scope,bucket),raw=Buffer.from(JSON.stringify(Object.fromEntries(group))),logical=hash(raw),receipt=key+'.json';let bytes,old;
  try{old=JSON.parse(cache.read(receipt));if(old.codec===codec&&old.logical===logical){bytes=cache.read(key+'.bin');if(hash(bytes)!==old.hash)bytes=null;}}catch{}
  if(bytes)stats.reused++;else{bytes=gzipSync(raw,{level:6});cache.write(key+'.bin',bytes);cache.write(receipt,Buffer.from(JSON.stringify({codec,logical,hash:hash(bytes)})));stats.encoded++;}
  if(bytes.length>25*1024*1024)throw Error('Packed asset exceeds 25 MiB: '+prefix+'/'+bucket);
  const sha=hash(bytes),path=prefix+'/'+bucket+'-'+sha+'.bin';assets.push({path,bytes});sources[path]=sha;rawBytes[path]=raw.length;
 }}finally{cache.close();}
 return {assets,manifest:{format:FORMAT,buckets,prefix,sources,rawBytes}};
}
