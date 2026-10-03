// One parse per selected native input, bounded memory, final live-byte verification.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const hash=b=>createHash('sha256').update(b).digest('hex');
export class VerifiedNativeInputs {
 constructor({maxParsedBytes=64*1024*1024}={}) {
  if(!Number.isSafeInteger(maxParsedBytes)||maxParsedBytes<0)throw Error('Invalid native input memory budget');
  this.limit=maxParsedBytes;this.checked=new Map();this.parsed=new Map();this.size=0;
  this.metrics={reads:0,bytesRead:0,hashes:0,decodes:0,parsedHits:0,fingerprintHits:0,finalReads:0,peakParsedBytes:0};
 }
 read(path) {const b=readFileSync(path);this.metrics.reads++;this.metrics.bytesRead+=b.length;return b;}
 digest(bytes) {this.metrics.hashes++;return hash(bytes);}
 check(path,expected) {
  const prior=this.checked.get(path);
  if(prior!==undefined) {
   if(expected&&prior!==expected)throw Error('Generated regional digest conflict: '+path);
   this.metrics.fingerprintHits++;return prior;
  }
  const digest=this.digest(this.read(path));
  if(expected&&digest!==expected)throw Error('Generated regional hash mismatch: '+path);
  this.checked.set(path,digest);return digest;
 }
 json(path,expected) {
  const prior=this.checked.get(path);
  if(expected&&prior!==undefined&&prior!==expected)throw Error('Generated regional digest conflict: '+path);
  const hit=this.parsed.get(path);
  if(hit) {this.parsed.delete(path);this.parsed.set(path,hit);this.metrics.parsedHits++;return hit.value;}
  const bytes=this.read(path),digest=this.digest(bytes);
  if((expected&&digest!==expected)||(prior!==undefined&&digest!==prior))throw Error('Generated regional input changed: '+path);
  this.checked.set(path,digest);
  const decoded=path.endsWith('.bin')?gunzipSync(bytes):bytes;
  const value=JSON.parse(decoded);this.metrics.decodes++;
  // JSON trees take more memory than their serialized bytes. Reserve a conservative
  // multiple; oversize inputs are returned without retaining another long-lived copy.
  const cost=decoded.length*4;
  if(cost<=this.limit) {
   while(this.size+cost>this.limit&&this.parsed.size) {const key=this.parsed.keys().next().value;this.size-=this.parsed.get(key).cost;this.parsed.delete(key);}
   this.parsed.set(path,{value,cost});this.size+=cost;
   this.metrics.peakParsedBytes=Math.max(this.metrics.peakParsedBytes,this.size);
  }
  return value;
 }
 verify() {
  for(const[path,digest]of this.checked) {
   this.metrics.finalReads++;
   if(this.digest(this.read(path))!==digest)throw Error('Generated input changed during packing: '+path);
  }
 }
}
