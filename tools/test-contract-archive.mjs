import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync,rmSync,realpathSync} from 'node:fs';
import {join,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {buildHousingRegions} from './build-housing-regions.mjs';
import {buildContractArchive} from './build-contract-archive.mjs';
import {GenerationFileSession} from './housing-generation-batch.mjs';
import {contractArchive,rentalDetail} from '../js/contract-archive.mjs';
import * as codec from '../js/generated/housing-columns.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('sparse contract archive preserves duplicate extras and incrementally refreshes changed regions',()=>{
 const root=mkdtempSync(join(tmpdir(),'contract-archive-')),source=join(root,'source'),seed=join(root,'seed'),cache=join(root,'cache'),database=join(root,'source.db'),old=process.env.NODO_FULL_VERIFY;delete process.env.NODO_FULL_VERIFY;
 const sources={},put=(p,v)=>{mkdirSync(join(source,p,'..'),{recursive:true});const bytes=Buffer.from(JSON.stringify(v));writeFileSync(join(source,p),bytes);sources[p]=hash(bytes);};
 const ids=['11110-A','99999-B'],months=['2025-09','2026-09'],regions=new Map([['11110',{identity:{complexes:ids,areas:[[0,'59.001'],[1,'59.002']]},metadata:{complexes:ids.map((id,i)=>({id,n:id,d:'동'+i,r:1,hasSale:true})),areas:[]}}]]),readers={verify(){}};
 try{
  put('data/index.json',{d:ids.map((as,i)=>({as,g:'g',i:as,a:59}))});put('data/tx/g.json',{entries:Object.fromEntries(ids.map(id=>[id,{2025:[[9,1,60000,2,0,''],[9,1,60000,2,0,'']],2026:[[9,1,60000,2,0,''],[9,1,60000,2,0,'']]}]))});
  const tx=JSON.parse(readFileSync(join(source,'data/tx/g.json')));tx.entries[ids[0]][2026].push([9,2,77777.25,0,4,'']);put('data/tx/g.json',tx);
  const excludedSales=[[ids[0],'59.001',20260902,77777.25,null,4,hash('missing source').slice(0,20)]];
  put('data/map/index.json',{meta:{sources:{},sourceVersion:'fixture'},d:[]});put('data/apartments/index.json',{sources:{}});put('data/rental/rates.json',{});put('data/rental/summary.json',{});
  const db=new DatabaseSync(database);db.exec('CREATE TABLE contract_record(service,entity_id,lawd,month,ordinal,payload); CREATE INDEX contract_record_entity ON contract_record(entity_id); CREATE TABLE contract_partition(service,lawd,month,checked_at)');
  const insert=db.prepare('INSERT INTO contract_record VALUES(?,?,?,?,?,?)');
  for(const month of months){db.prepare('INSERT INTO contract_partition VALUES(?,?,?,?)').run('apartment-rent','11110',month.replace('-',''),'2026-10-19');for(const [i,id]of ids.entries())for(let n=0;n<2;n++){
   const raw={aptSeq:id,area:59.001+i*.001,buildYear:1991,cancelDate:'',cancelled:false,category:'monthly',contractTerm:'26.09~28.08',contractType:'갱신',date:month+'-01',deposit:10000.25,dong:'동'+i,entityId:id,floor:-1,identityStatus:'source',jibun:'91',kind:'rent',monthlyRent:100.25,name:id,previousDeposit:9000.25,previousMonthlyRent:null,price:null,property:'apartment',renewalRight:'사용'};
   insert.run('apartment-rent',id,'11110',month.replace('-',''),n,JSON.stringify(raw));
  }}
  db.close();
  for(const kind of ['daily','rental']){const manifest={schema:2,months,sources,regional:{bases:{11110:Object.fromEntries(months.map(m=>[m,true]))}}};put('data/'+kind+'/index.json',manifest);
   readers[kind]={manifest,table:{regions},inputs:{},regionMonth(code,m){return {rows:ids.flatMap((id,i)=>{const identity=hash(m+id).slice(0,20),date=Number(m.replace('-','')+'01'),row=kind==='daily'?[code+':'+i,date,60000,2,0,null,null,null,null,0,identity,null]:[code+':'+i,(59.001+i*.001).toString(),date,10000.25,100.25,2,-1,0,null,null,null,null,null,101,0,null,null,identity];return [row,row];}),opening:[],updates:[]};}};
  }
  buildHousingRegions(source,seed,codec,{readers});let sequence=0;const batch={schema:1,revision:'first',seq:0,batches:[]};
  function run(accept=false){const out=join(root,'out'+sequence++);cpSync(seed,out,{recursive:true});writeFileSync(join(out,'data/apartment-rent.json'),'{}');mkdirSync(join(out,'data/apartment-rent'),{recursive:true});writeFileSync(join(out,'data/apartment-rent/index.json'),JSON.stringify({schema:2}));const session=new GenerationFileSession({site:source,output:out,cache,batch,engine:'fixture'}),report=buildContractArchive({packed:out,database,generationSession:session}),consumption=session.finish();if(accept)writeFileSync(join(cache,'generation-consumer.json'),readFileSync(consumption.pending));return {out,report};}
  const first=run(true);assert.equal(first.report.rows,8);assert.equal(first.report.built,1);assert.equal(run().report.reused,1);
  const bytes=gunzipSync(readFileSync(join(first.out,'data/contracts/apartment-rent/11110/archive-details.bin'))),lookup=contractArchive(bytes);const fact=readers.rental.regionMonth('11110','2025-09').rows[2],result=rentalDetail(fact,ids[1],1,lookup);assert.equal(result.deposit,10000.25);assert.equal(result.previousDeposit,9000.25);assert.equal(result.previousMonthlyRent,null);assert.equal(result.renewalRight,'사용');assert.equal(result.recordOccurrence,1);
  const update=new DatabaseSync(database);for(const row of update.prepare('SELECT rowid,payload FROM contract_record WHERE entity_id=?').all(ids[1])){const value=JSON.parse(row.payload);value.renewalRight='미사용';update.prepare('UPDATE contract_record SET payload=? WHERE rowid=?').run(JSON.stringify(value),row.rowid);}update.close();
  const payload=JSON.stringify({schema:1,previousRevision:'first',revision:'second',complete:true,saleSources:[],rentalPartitions:[{lawd:'11110',month:'202609',sources:[ids[1]]}]});Object.assign(batch,{revision:'second',seq:1,batches:[{seq:1,payload,digest:hash(payload)}]});const changed=run(true);assert.equal(changed.report.built,1);const next=contractArchive(gunzipSync(readFileSync(join(changed.out,'data/contracts/apartment-rent/11110/archive-details.bin'))));assert.equal(rentalDetail(fact,ids[1],1,next).renewalRight,'미사용');assert.equal(run().report.reused,1);
 }finally{if(old===undefined)delete process.env.NODO_FULL_VERIFY;else process.env.NODO_FULL_VERIFY=old;const resolved=realpathSync(root),base=realpathSync(tmpdir());if(!resolved.startsWith(base+sep)||!resolved.slice(base.length+1).startsWith('contract-archive-'))throw Error('Unsafe test cleanup');rmSync(resolved,{recursive:true,force:true});}
});
