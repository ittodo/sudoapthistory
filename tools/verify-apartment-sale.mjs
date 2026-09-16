// Integrity verification of Rust-generated DTOs; semantic verification runs in Rust.
import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {fileHash} from './verify-apartment-rent.mjs';
export function verifyApartmentSale(root) {
  const safe=path=>{let current=root;for(const part of path.split('/')){if(!part||part==='.'||part==='..'||/[\\:]/.test(part))throw Error('Unsafe apartment path');current=join(current,part);if(lstatSync(current).isSymbolicLink())throw Error('Unsafe apartment link');}return current;};
  const index=JSON.parse(readFileSync(safe('data/apartments/index.json'),'utf8'));
  if(index.version!==1 || !index.sources || !index.shards || Object.keys(index.shards).length!==512)throw Error('Invalid apartment index');
  const check=(path,hash)=>{if(!/^[a-f0-9]{64}$/.test(hash)||fileHash(safe(path))!==hash)throw Error('Apartment data out of date: '+path);};
  for(const path of ['data/index.json','data/map/index.json','data/housing-v3/index.json'])if(!index.sources[path])throw Error('Missing apartment source: '+path);
  for(const [path,hash] of Object.entries(index.sources)){
    if(!/^data\/(?:index|map\/index|housing-v3\/index|building-status|tx\/[^/\\:]+)\.json$/.test(path))throw Error('Invalid apartment source path');
    check(path,hash);
  }
  for(let i=0;i<256;i++)for(const prefix of ['', 'summary/']){
    const path=`data/apartments/${prefix}${i.toString(16).padStart(2,'0')}.json`;
    check(path,index.shards[path]);
  }
  return {count:index.count,shards:256,verified:true};
}
