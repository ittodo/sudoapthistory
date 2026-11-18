import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join,dirname,toNamespacedPath} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as codec from '../js/generated/housing-columns.mjs';
import {packQuarter,encodeQuarter} from '../js/housing-quarter.mjs';
import {verifyHousingRegions} from './verify-housing-regions.mjs';
import {currentReviewContract} from './housing-publication-contract.mjs';
import {dataValidationProof,proofPath} from './data-validation-proof.mjs';
import {closeCacheStores} from './cache-store.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
// write() can rebuild the same root with an appended identity table or new
// quarter bytes. Quarter bytes do not encode identity table length.
function fixture(options={}){
 const root=mkdtempSync(join(tmpdir(),'housing-regions-proof-'));
 const put=(name,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value)),path=join(root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);return hash(bytes);};
 const read=name=>JSON.parse(readFileSync(join(root,name)));
 const write=next=>writeFixture(root,{...options,...next});write({});
 const quarter='data/daily/regions/11110/quarters/2026-Q3.bin',identityPath='data/daily/regions/11110/identities.json';
 return {root,put,read,quarter,identityPath,write,close:()=>{closeCacheStores();rmSync(root,{recursive:true,force:true});}};
}
function writeFixture(root,{legacy=false,alterMap=null,alterHousing=null,identity={complexes:['A'],areas:[[0,'59.1234567']]},price=60000,contracts=false}){
 const put=(name,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value)),path=join(root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);return hash(bytes);};
 const housing={meta:legacy?{approvedOnly:true}:{contract:currentReviewContract,candidateOnly:false,approvedOnly:false,sourceVersion:'publication'},complexes:[{id:'one',review:{approved:false}}]};
 const map={meta:legacy?{sourceVersion:'final-admin'}:{contract:currentReviewContract,candidateOnly:false,sourceVersion:'final-admin',publicationSourceVersion:'publication'},d:[{id:'one',memberSources:[{id:'A'}]}]};
 alterHousing?.(housing);alterMap?.(map);
 const metadataSources={
  'data/index.json':put('data/index.json',{d:[{as:'A',i:7,a:59}]}),
  'data/housing-v3/index.json':put('data/housing-v3/index.json',housing),
  'data/map/index.json':put('data/map/index.json',map)
 };
 const base='data/daily/regions/11110',record='ab'.repeat(10);
 const sale=['11110:0',20260901,price,null,0,null,null,null,null,1,record,null];
 const months={'2026-09':{daily:{rows:[sale],updates:[['11110:0',20260901,price,price,price,1]],opening:[]},rental:{rows:[],updates:[],opening:[]}}};
 const quarter=base+'/quarters/2026-Q3.bin',identityPath=base+'/identities.json',metadataPath=base+'/metadata.json',authority='data/daily/regions/index.json';
 const sources={
  [quarter]:put(quarter,gzipSync(encodeQuarter(packQuarter('11110','2026-Q3',months,identity,codec)))),
  [identityPath]:put(identityPath,identity),
  [metadataPath]:put(metadataPath,{complexes:identity.complexes.map((id,i)=>({id,n:i?'원천 이름'+i:'원천 이름',r:1,g:'종로구',hasSale:true,hasRental:true,publicId:i?'other'+i:'one'})),areas:[]}),
  [authority]:put(authority,{schema:3,regions:{11110:{identities:identityPath,metadata:metadataPath}}})
 };
 for(const kind of ['daily','rental'])put(`data/${kind}/index.json`,{schema:3,version:kind+'-version',months:['2026-09'],mapVersion:'final-admin',sources:{...sources,...(kind==='daily'?{'data/map/index.json':metadataSources['data/map/index.json']}:{})},regional:{format:'packed-region',kind,authority,quarters:{11110:{'2026-09':quarter}},states:{11110:{'2026-09':null}}}});
 const reference='data/sale-details/11110/2026.bin';
 metadataSources['data/sale-details/index.json']=put('data/sale-details/index.json',{schema:1,format:'sale-fact-references',regions:{11110:{2026:reference}},sources:{[reference]:put(reference,gzipSync(codec.encodeColumns(codec.schemas.SaleDetailReference,[[0,59,record,0,0,'']])))},facts:{[identityPath]:sources[identityPath],[quarter]:sources[quarter]},excluded:{}});
 const shards={};for(let i=0;i<256;i++)for(const prefix of ['', 'summary/']){const path=`data/apartments/${prefix}${i.toString(16).padStart(2,'0')}.json`;shards[path]=put(path,i===0?{one:{id:'one',review:{approved:false},areas:[{area:59,rows:[{i:7,commentId:'apt_7'}]}]}}:{});}
 const catalogHash=put('data/apartments/index.json',{version:2,count:1,sources:metadataSources,shards,lookup:{A:['one','00'],one:['one','00']},legacy:{7:['one',59]},ambiguous:[]});
 // An empty regional-reference partition still restores against identity 11110.
 // Officetel months live in regional bundles: recent.json holds one month with rows and its month file (stage 1)
 // and one zero-row month without a file; the year bundle 2025.json holds a retained month without a file.
 const partitions=contracts?[{format:'regional-reference',service:'apartment-rent',lawd:'11110',month:'202609',details:null,unmatched:null,display:null,regionCodes:['11110'],count:0},{service:'officetel-rent',lawd:'11110',month:'202609',path:null,count:0,checkedAt:'now',bundle:'officetel-rent/11110/recent.json'},{service:'officetel-rent',lawd:'11110',month:'202610',path:'officetel-rent/11110/202610.json',count:1,checkedAt:'now',bundle:'officetel-rent/11110/recent.json'},{service:'officetel-rent',lawd:'11110',month:'202509',path:null,count:1,checkedAt:'now',bundle:'officetel-rent/11110/2025.json'}]:[];
 const officetelRow={date:'2026-10-02',area:24.5,deposit:100},contractSources=contracts?{'data/contracts/officetel-rent/11110/recent.json':put('data/contracts/officetel-rent/11110/recent.json',{schema:1,months:{202609:[],202610:[officetelRow]}}),'data/contracts/officetel-rent/11110/2025.json':put('data/contracts/officetel-rent/11110/2025.json',{schema:1,months:{202509:[{...officetelRow,date:'2025-09-02'}]}}),'data/contracts/officetel-rent/11110/202610.json':put('data/contracts/officetel-rent/11110/202610.json',{rows:[officetelRow]})}:{};
 const contractsHash=put('data/contracts/index.json',{schema:2,rentalVersion:'rental-version',sources:contractSources,partitions});
 let contractArchive;if(contracts){const detail='data/contracts/apartment-rent/11110/archive-details.bin',coverage='data/contracts/apartment-rent/coverage.bin',sources={[detail]:put(detail,gzipSync(codec.encodeColumns(codec.schemas.ContractDetail,[]))),[coverage]:put(coverage,gzipSync(Buffer.from('{}')))};contractArchive={schema:1,regions:{11110:detail},coverageRef:{path:coverage,sha256:sources[coverage]},rows:0,sources,...(typeof contracts==='object'?contracts:{})};}
 put('data/apartment-rent/index.json',{schema:2,rentalVersion:'rental-version',contractsHash,catalogHash,sources:{},...(contractArchive?{contractArchive}:{})});
}

test('full regional verifier records final current metadata after actual packed fact checks',()=>{
 const f=fixture();try{
  const quarterBefore=readFileSync(join(f.root,f.quarter)),result=verifyHousingRegions(f.root),proof=dataValidationProof(f.root);
  assert.equal(result.status,'PASS');assert.equal(result.sales.rows,1);assert.equal(result.sales.status,'PASS');assert.equal(result.details.status,'PASS');assert.equal(result.apartment.verified,true);
  assert.equal(result.daily.regionMonths,1);assert.equal(result.rental.regionMonths,1);
  assert.deepEqual(result.currentReview,{contract:currentReviewContract,sourceVersion:'publication',housingSha256:hash(readFileSync(join(f.root,'data/housing-v3/index.json'))),mapSha256:hash(readFileSync(join(f.root,'data/map/index.json'))),individualApprovals:'preserved_from_workbench'});
  assert.equal(result.currentReview.buildingAudit,undefined);assert.equal(proof.status,'VERIFIED');assert.deepEqual(proof.checks.currentReview,result.currentReview);assert.equal(proof.checks.saleRows,1);
  assert.deepEqual(readFileSync(join(f.root,f.quarter)),quarterBefore);assert.equal(f.read('data/housing-v3/index.json').complexes[0].review.approved,false);
 }finally{f.close();}
});

test('legacy regional verifier retains fact verification without a current review claim',()=>{
 const f=fixture({legacy:true});try{const result=verifyHousingRegions(f.root);assert.equal(result.sales.rows,1);assert.equal(result.currentReview,undefined);assert.equal(dataValidationProof(f.root).status,'VERIFIED');assert.equal(dataValidationProof(f.root).checks.currentReview,undefined);}finally{f.close();}
});

test('candidate and mismatched current source versions cannot produce a completion proof',()=>{
 for(const options of [{alterHousing:h=>h.meta.candidateOnly=true},{alterMap:m=>m.meta.publicationSourceVersion='different'}]){
  const f=fixture(options);try{assert.throws(()=>verifyHousingRegions(f.root),/Candidate metadata|source version mismatch/);assert.equal(existsSync(join(f.root,proofPath)),false);}finally{f.close();}
 }
});

test('matching current metadata cannot bypass invalid packed facts with freshly matching hashes',()=>{
 const f=fixture();try{
  const broken=f.put(f.quarter,gzipSync(Buffer.from('invalid packed facts')));
  for(const kind of ['daily','rental']){const path=`data/${kind}/index.json`,m=f.read(path);m.sources[f.quarter]=broken;f.put(path,m);}
  assert.throws(()=>verifyHousingRegions(f.root));assert.equal(existsSync(join(f.root,proofPath)),false);
 }finally{f.close();}
});

for(const extended of [false,...(process.platform==='win32'?[true]:[])]){
 test(`regional CLI executes actual verification through ${extended?'Windows extended':'ordinary'} paths`,()=>{
  const f=fixture();try{
   const script=fileURLToPath(new URL('./verify-housing-regions.mjs',import.meta.url)),path=extended?toNamespacedPath(script):script;
   if(extended)assert.ok(path.startsWith('\\\\?\\'));
   const output=spawnSync(process.execPath,[path,extended?toNamespacedPath(f.root):f.root],{encoding:'utf8'});
   assert.ifError(output.error);assert.equal(output.status,0,output.stderr);
   assert.ok(output.stdout.trim(),'CLI must emit its verification result');const result=JSON.parse(output.stdout);
   assert.equal(result.status,'PASS');assert.equal(result.sales.rows,1);assert.equal(result.apartment.verified,true);
   assert.equal(result.currentReview.contract,currentReviewContract);assert.equal(dataValidationProof(f.root).status,'VERIFIED');
   const missing=spawnSync(process.execPath,[path],{encoding:'utf8'});
   assert.ifError(missing.error);assert.notEqual(missing.status,0);assert.match(missing.stderr,/SITE required/);
  }finally{f.close();}
 });
}

test('importing the regional verifier does not run its CLI',()=>{
 const script=fileURLToPath(new URL('./verify-housing-regions.mjs',import.meta.url));
 // Node 22 reports its SQLite experimental warning on import. This assertion
 // checks CLI output, so suppress that runtime warning only in this child.
 const output=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(script).href)})`],{encoding:'utf8'});
 assert.ifError(output.error);assert.equal(output.status,0,output.stderr);assert.equal(output.stdout,'');assert.equal(output.stderr,'');
});

test('appended identity numbers reuse region, sale and detail receipts; changed prefixes and quarter bytes check again',()=>{
 const one={complexes:['A'],areas:[[0,'59.1234567']]},grown={complexes:['A','B'],areas:[[0,'59.1234567'],[1,'84.1'],[0,'84.2']]};
 const f=fixture({contracts:true});try{
  const first=verifyHousingRegions(f.root);
  assert.equal(first.daily.validation.checked,1);assert.equal(first.sales.validation.checked,1);assert.deepEqual(first.details.validation,{checked:2,reused:0});
  f.write({identity:grown});const appended=verifyHousingRegions(f.root);
  assert.deepEqual(appended.daily.validation,{checked:0,reused:1});assert.deepEqual(appended.sales.validation,{checked:0,reused:1});assert.deepEqual(appended.details.validation,{checked:0,reused:2});
  assert.equal(appended.sales.rows,1);assert.equal(dataValidationProof(f.root).status,'VERIFIED');
  // A changed recorded element (the exact area of number 0) requires normal checks.
  f.write({identity:{complexes:grown.complexes,areas:[[0,'59.2'],...grown.areas.slice(1)]}});const changed=verifyHousingRegions(f.root);
  assert.equal(changed.daily.validation.checked,1);assert.equal(changed.sales.validationMisses.identity,1);assert.equal(changed.details.validationMisses.identity,1);
  // New quarter bytes miss on inputs even though identity numbers only grew.
  f.write({identity:{complexes:[...grown.complexes,'C'],areas:[[0,'59.2'],...grown.areas.slice(1)]},price:61000});const quarter=verifyHousingRegions(f.root);
  assert.equal(quarter.daily.validation.checked,1);assert.equal(quarter.sales.validationMisses.inputs,1);
  // Identity bytes that no longer match the manifest are a hard failure, not a miss.
  writeFileSync(join(f.root,f.identityPath),JSON.stringify({...one,complexes:['A']}));
  assert.throws(()=>verifyHousingRegions(f.root),/Regional source mismatch/);
 }finally{f.close();}
});

test('contract archive receipts skip decoding only; current archive bytes and descriptors still gate',()=>{
 const f=fixture({contracts:true});try{
  verifyHousingRegions(f.root);f.write({identity:{complexes:['A'],areas:[[0,'59.1234567'],[0,'84.1']]}});
  const reused=verifyHousingRegions(f.root);assert.equal(reused.details.validation.reused,2);
  const detail=join(f.root,'data/contracts/apartment-rent/11110/archive-details.bin');
  // Call the detail checker directly: the outer manifest check would reject first.
  assert.equal(verifyHousingDetails(f.root).validation.reused,2);
  writeFileSync(detail,gzipSync(Buffer.from('damaged archive')));
  assert.throws(()=>verifyHousingDetails(f.root),/Contract archive digest\/size mismatch/);
  // A changed descriptor (rows) is a new receipt key, so the archive is decoded and rejected.
  f.write({contracts:{rows:1}});assert.throws(()=>verifyHousingRegions(f.root),/Orphan contract archive source/);
 }finally{f.close();}
});

import {regionalReader} from './regional-reader.mjs';
import {verifyHousingDetails} from './verify-housing-details.mjs';
import {utimesSync} from 'node:fs';
test('regional reader recheck compares strengthened signatures without content and still rehashes by default',()=>{
 const f=fixture();try{
  const reader=regionalReader(f.root,'daily',{verifyOnce:true}),path=join(f.root,f.quarter);reader.physical(f.quarter,false);
  reader.recheck({content:false});reader.recheck();
  const later=new Date(Date.now()+5000);utimesSync(path,later,later);
  assert.throws(()=>reader.recheck({content:false}),/changed during build/);assert.throws(()=>reader.recheck(),/changed during build/);
 }finally{f.close();}
});
