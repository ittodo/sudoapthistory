import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {privateCache} from './private-cache.mjs';

export const housingMetadataSource='data/housing-v3/index.json';
export const housingMetadataManifest='data/housing-v3/transport.json';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const codec=hash(readFileSync(new URL('./housing-metadata-transport.mjs',import.meta.url)));
export function housingMetadataTransport(root,{stats={}}={}){
 const sourceFile=join(root,housingMetadataSource);if(!existsSync(sourceFile))return null;
 let parent=root,sourceStat;for(const part of housingMetadataSource.split('/')){parent=join(parent,part);sourceStat=lstatSync(parent);if(sourceStat.isSymbolicLink())throw Error('Symlink housing metadata source');}
 if(sourceStat.size>128*1024*1024)throw Error('Housing metadata source exceeds 128 MiB');
 const raw=readFileSync(sourceFile);if(raw.length>128*1024*1024)throw Error('Housing metadata source exceeds 128 MiB');
 const digest=hash(raw),scope='cloudflare/dist/housing-metadata-transport-v1',key=join(root,scope,'index.bin'),receipt=key+'.json';
 const fingerprint=hash(JSON.stringify(['gzip-json-v1',codec,digest])),cache=privateCache(root,scope);let bytes;
 Object.assign(stats,{encoded:0,reused:0,sourceBytes:raw.length});
 try{
  try{const saved=JSON.parse(cache.read(receipt));if(saved.fingerprint===fingerprint){const old=cache.read(key);if(hash(old)===saved.sha256)bytes=old;}}catch{}
  if(bytes)stats.reused++;else{bytes=gzipSync(raw,{level:6});cache.write(key,bytes);cache.write(receipt,JSON.stringify({fingerprint,sha256:hash(bytes)}));stats.encoded++;}
 }finally{cache.close();}
 if(bytes.length>25*1024*1024)throw Error('Housing metadata transport exceeds 25 MiB');
 const rentalComplexIds=[...new Set((JSON.parse(raw).complexes||[]).filter(p=>p.housingFamily==='apartment'&&p.tenure==='rental').map(p=>p.id))].sort();
 const manifest={schema:1,format:'gzip-json-v1',source:{path:housingMetadataSource,sha256:digest,bytes:raw.length},file:{path:`data/housing-v3/index.${digest}.bin`,sha256:hash(bytes),bytes:bytes.length},rentalComplexIds};
 stats.bytes=bytes.length;
 return {manifest,assets:[{path:manifest.file.path,bytes},{path:housingMetadataManifest,bytes:Buffer.from(JSON.stringify(manifest))}],
  recheck(){if(hash(readFileSync(sourceFile))!==digest)throw Error('Housing metadata source changed during packaging');}};
}
export function housingMetadataHeaders(transport){
 return transport?`/${transport.manifest.file.path}\n  Cache-Control: public, max-age=31536000, immutable\n`:'';
}
