import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {restoreApartmentEntry} from '../js/apartment-entry.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function verifyApartmentEntries(root){
 const index=JSON.parse(readFileSync(join(root,'data/apartments/entry-index.json')));
 if(![2,3].includes(index.schema)||Object.keys(index.sources||{}).length!==64)throw Error('Missing apartment entry directory');
 for(const[kind,path]of Object.entries({sale:'data/sale-details/index.json',rental:'data/apartment-rent/index.json',catalog:'data/apartments/index.json'}))if(hash(readFileSync(join(root,path)))!==index.basis[kind])throw Error('Apartment entry basis changed');
 const catalog=JSON.parse(readFileSync(join(root,'data/apartments/index.json')));
 if(index.schema===3&&JSON.stringify(index.shards)!==JSON.stringify(catalog.shards))throw Error('Apartment entry shard hashes changed');
 for(const[path,sha]of Object.entries(index.sources)){if(!/^data\/apartments\/entry\/[0-3][a-f0-9]\.json$/.test(path))throw Error('Invalid apartment entry path');let file=root;for(const part of path.split('/')){file=join(file,part);if(lstatSync(file).isSymbolicLink())throw Error('Linked apartment entry');}const bytes=readFileSync(file),raw=JSON.parse(bytes),entry=restoreApartmentEntry(raw,index);if(hash(bytes)!==sha||raw.schema!==index.schema||entry.basis.sale!==index.basis.sale||entry.basis.rental!==index.basis.rental||entry.format!==catalog.format||entry.updated!==catalog.updated||entry.propertyUpdated!==catalog.propertyUpdated||JSON.stringify(entry.sources)!==JSON.stringify(catalog.sources))throw Error('Apartment entry bytes changed');
  for(const ref of [...Object.values(entry.lookup),...Object.values(entry.summaries||{}),...Object.values(entry.legacy)])if(!/^data\/apartments\/(?:summary\/)?[a-f0-9]{2}\.(?:json|bin)$/.test(ref[1])||catalog.shards[ref[1]]!==ref[2]||catalog.lookup[ref[0]]?.[0]!==ref[0])throw Error('Apartment entry reference changed');
 }
 return {status:'PASS',files:64};
}
