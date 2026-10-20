import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function verifyApartmentEntries(root){
 const index=JSON.parse(readFileSync(join(root,'data/apartments/entry-index.json')));
 if(index.schema!==2||Object.keys(index.sources||{}).length!==64)throw Error('Missing apartment entry directory');
 for(const[kind,path]of Object.entries({sale:'data/sale-details/index.json',rental:'data/apartment-rent/index.json',catalog:'data/apartments/index.json'}))if(hash(readFileSync(join(root,path)))!==index.basis[kind])throw Error('Apartment entry basis changed');
 for(const[path,sha]of Object.entries(index.sources)){if(!/^data\/apartments\/entry\/[0-3][a-f0-9]\.json$/.test(path))throw Error('Invalid apartment entry path');let file=root;for(const part of path.split('/')){file=join(file,part);if(lstatSync(file).isSymbolicLink())throw Error('Linked apartment entry');}const bytes=readFileSync(file),entry=JSON.parse(bytes);if(hash(bytes)!==sha||entry.schema!==2||entry.basis.sale!==index.basis.sale||entry.basis.rental!==index.basis.rental)throw Error('Apartment entry bytes changed');}
 return {status:'PASS',files:64};
}
