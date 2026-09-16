// Deployment verifies the Rust-built input/output hashes without rebuilding rows.
// Semantic recomputation belongs to site_release.py / Rust verify mode.
import {openSync,readSync,closeSync,readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

function safe(root,path) {
  if(path.split('/').some(p=>!p || p==='.' || p==='..' || /[\\:]/.test(p))) throw Error('Unsafe rent path');
  let current=root;
  for(const part of path.split('/')) {current=join(current,part);if(lstatSync(current).isSymbolicLink()) throw Error('Symlink rent path');}
  return current;
}
export function fileHash(path) {
  const fd=openSync(path,'r'), hash=createHash('sha256'), buffer=Buffer.allocUnsafe(65536);
  try {let n;while((n=readSync(fd,buffer,0,buffer.length,null))) hash.update(buffer.subarray(0,n));}
  finally {closeSync(fd);}
  return hash.digest('hex');
}
export function verifyApartmentRent(root) {
  const index=JSON.parse(readFileSync(safe(root,'data/apartment-rent/index.json'),'utf8'));
  const check=(path,expected)=>{if(!/^[a-f0-9]{64}$/.test(expected) || fileHash(safe(root,path))!==expected) throw Error('Rent output out of date: '+path);};
  if(index.schema!==1 || !index.sources || !index.shards) throw Error('Invalid rent index');
  check('data/contracts/index.json',index.contractsHash);
  check('data/apartments/index.json',index.catalogHash);
  const manifest=JSON.parse(readFileSync(safe(root,'data/contracts/index.json'),'utf8'));
  const paths=manifest.partitions.map(p=>'data/contracts/'+p.path);
  if(new Set(paths).size!==paths.length || paths.length!==Object.keys(index.sources).length) throw Error('Rent source set mismatch');
  for(const path of paths) {
    if(!/^data\/contracts\/[a-z-]+\/\d{5}\/\d{6}\.json$/.test(path)) throw Error('Invalid contract partition path');
    check(path,index.sources[path]);
  }
  for(const [path,expected] of Object.entries(index.shards)) {
    if(!/^data\/apartment-rent\/[0-9a-f]{2}\.json$/.test(path)) throw Error('Invalid rent shard path');
    check(path,expected);
  }
  if(!index.records || typeof index.records!=='object' || Array.isArray(index.records)) throw Error('Invalid rent records');
  const required=new Set(Object.values(index.records).map(record=>`data/apartment-rent/${record.shard}.json`));
  if(required.size!==Object.keys(index.shards).length || [...required].some(path=>!Object.hasOwn(index.shards,path))) throw Error('Rent shard set mismatch');
  return {total:index.total,linked:index.linked,files:Object.keys(index.shards).length+1,verified:true};
}
