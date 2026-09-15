import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {operationsMetadata} from './operations-metadata.mjs';
test('operations metadata preserves source units and dates without copying source records',()=>{
 const root=mkdtempSync(join(tmpdir(),'nodo-ops-'));try{
  mkdirSync(join(root,'data/apartment-rent'),{recursive:true});
  writeFileSync(join(root,'data/apartment-rent/index.json'),JSON.stringify({total:9,linked:6,coverage:{district:{month:'2026-09-14T00:00:00Z'}},records:{private:'never copied'}}));
  writeFileSync(join(root,'data/index.json'),JSON.stringify({meta:{updated:'2026-09-13',total:3},d:[{name:'never copied'}]}));
  const r=operationsMetadata(root);assert.equal(r.data[1].count,9);assert.equal(r.data[1].linked,6);assert.match(r.data[1].updated,/2026-09-14/);assert.equal(r.data[2].unit,'평형별 항목');assert.equal(r.data[0].status,'error');assert.ok(!JSON.stringify(r).includes('never copied'));
 }finally{rmSync(root,{recursive:true,force:true});}
});
