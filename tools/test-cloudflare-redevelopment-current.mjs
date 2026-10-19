import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {verifyRedevelopmentData} from './verify-redevelopment-data.mjs';

const contract='current-review-publication-v1',sourceVersion='a'.repeat(64);
const key=row=>`${row.r}|${row.g}|${row.d}|${row.j}`;
function fixture(){
  const rows=['active','closed','partial_closed','unknown'].map((state,i)=>({i,as:`source-${i}`,r:0,g:'시',d:'동',j:String(i+1),state}));
  const sites=Object.fromEntries(rows.map(row=>[key(row),{status:row.state,date:null,basis:'current_ledger_connections',demolitionConfirmed:false,displayName:row.as,sourceIds:[row.as]}]));
  return {index:{d:rows},status:{version:2,contract,candidateOnly:false,approvedOnly:false,sourceVersion,sites},housing:{meta:{contract,candidateOnly:false,approvedOnly:false,sourceVersion}},relationData:{version:1,relations:[]},evidenceData:{evidence:{}}};
}
test('current ledger states retain closed and unknown with source ownership and no demolition claim',()=>{
  const data=fixture(),before=JSON.stringify(data),result=verifyRedevelopmentData(data);
  assert.deepEqual(result.errors,[]);
  assert.equal(result.mode,'current-review');
  assert.equal(result.statuses,4);
  assert.equal(JSON.stringify(data),before);
});
test('current status verification rejects stale versions, previews, unsupported states and invented source claims',()=>{
  const cases={
    stale:d=>d.status.sourceVersion='b'.repeat(64),
    preview:d=>d.status.candidateOnly=true,
    approval:d=>d.status.approvedOnly=true,
    missingContract:d=>delete d.status.contract,
    demolished:d=>Object.values(d.status.sites)[1].status='demolished',
    rebuilding:d=>Object.values(d.status.sites)[1].status='rebuilding',
    demolition:d=>Object.values(d.status.sites)[1].demolitionConfirmed=true,
    basis:d=>Object.values(d.status.sites)[1].basis='old_audit',
    source:d=>Object.values(d.status.sites)[1].sourceIds=['another-source'],
    duplicate:d=>Object.values(d.status.sites)[1].sourceIds.push('source-1'),
    absent:d=>delete d.status.sites[key(d.index.d[3])],
    oldFlag:d=>d.index.d[1].bs='멸실',
  };
  for(const [name,change]of Object.entries(cases)){const data=fixture();change(data);assert.ok(verifyRedevelopmentData(data).errors.length,name);}
});
test('legacy demolition still needs matching flags and unknown cannot establish an inactive historical predecessor',()=>{
  const data=fixture();delete data.status.contract;delete data.housing;
  for(const item of Object.values(data.status.sites))item.status='active';
  data.index.d[0].bs='멸실';data.index.d[0].bsd='20260101';
  Object.assign(data.status.sites[key(data.index.d[0])],{status:'demolished',date:'20260101'});
  assert.deepEqual(verifyRedevelopmentData(data).errors,[]);
  data.status.sites[key(data.index.d[0])].date='20260102';
  assert.ok(verifyRedevelopmentData(data).errors.some(e=>e.includes('bsd mismatch')));
  delete data.index.d[0].bs;delete data.index.d[0].bsd;
  data.status.sites.historical={status:'unknown',displayName:'확인 안 된 단지'};
  data.relationData.relations=[{id:'relation',stage:'planned',verifiedAt:'2026-10-19',predecessors:[{siteKey:'historical',scope:'all'}],successors:[{siteKey:key(data.index.d[1])}]}];
  const errors=verifyRedevelopmentData(data).errors;
  assert.ok(errors.some(e=>e.includes('invalid status unknown')));
  assert.ok(errors.some(e=>e.includes('unresolved predecessor')));
});
test('a historical predecessor needs its exact explicit decision and the same relation evidence without altering current ledger state',()=>{
  const data=fixture(),historical='2|서구|석남동|521-2';
  data.relationData.relations=[{id:'historical-redevelopment',stage:'construction',verifiedAt:'2026-10-19',predecessors:[{siteKey:historical,scope:'all'}],successors:[{siteKey:key(data.index.d[0])}],evidenceIds:['official-history']}];
  data.evidenceData.evidence={'official-history':{title:'사업 근거',url:'https://example.invalid/evidence',checkedAt:'2026-10-19'}};
  data.decisionData={version:1,sites:{[historical]:{status:'rebuilding',displayName:'이전 단지',evidenceId:'official-history'},[key(data.index.d[1])]:{status:'demolished',displayName:'구 판정',evidenceId:'official-history'}}};
  const before=JSON.stringify(data.status),result=verifyRedevelopmentData(data);
  assert.deepEqual(result.errors,[]);assert.equal(result.warnings.length,1);
  assert.equal(JSON.stringify(data.status),before);
  assert.equal(data.status.sites[key(data.index.d[1])].status,'closed');
  const changes={
    wrongKey:d=>{d.decisionData.sites.other=d.decisionData.sites[historical];delete d.decisionData.sites[historical];},
    unknown:d=>d.decisionData.sites[historical].status='unknown',
    active:d=>d.decisionData.sites[historical].status='active',
    missingName:d=>delete d.decisionData.sites[historical].displayName,
    missingEvidence:d=>delete d.evidenceData.evidence['official-history'],
    differentEvidence:d=>d.decisionData.sites[historical].evidenceId='other',
    unrelatedEvidence:d=>d.relationData.relations[0].evidenceIds=[],
  };
  for(const [name,change]of Object.entries(changes)){const changed=structuredClone(data);change(changed);assert.ok(verifyRedevelopmentData(changed).errors.some(e=>e.includes('unresolved predecessor')),name);}
});

const source=readFileSync(new URL('../js/main-app.js',import.meta.url),'utf8');
const lifecycle=source.slice(source.indexOf('function siteKeyOf('),source.indexOf('function updateLifecycleCounts('));
function browser(rows){
  const context=vm.createContext({D:rows,DM:[],merged:false,includeInactive:false,BUILDING_STATUS:null,REDEVELOPMENT_RELATIONS:null,SITE_ENTRY:null,REL_BY_SITE:null,escHtml:value=>String(value),console:{warn(){}},fetch:async()=>{throw Error('offline');}});
  vm.runInContext(lifecycle,context);
  return context;
}
test('actual browser status code keeps closed and unknown visible without calling either demolished or active',()=>{
  const data=fixture(),view=browser(data.index.d);
  view.applyLifecycleData({status:data.status,relations:data.relationData});
  assert.equal(view.lifecycleSource().length,4);
  assert.equal(data.index.d[1]._status,'closed');
  assert.equal(data.index.d[3]._status,'unknown');
  assert.equal(data.index.d[1]._hiddenInactive,false);
  assert.equal(data.index.d[3]._hiddenInactive,false);
  assert.match(view.statusBadgeHtml(data.index.d[1]),/대장 폐쇄·말소/);
  assert.match(view.statusBadgeHtml(data.index.d[1]),/철거 확정을 뜻하지 않습니다/);
  assert.match(view.statusBadgeHtml(data.index.d[3]),/상태 미확인/);
  delete data.status.sites[key(data.index.d[1])];data.index.d[1].bs='멸실';data.index.d[1].bsd='20000101';
  view.applyLifecycleData({status:data.status,relations:data.relationData});
  assert.equal(data.index.d[1]._status,'unknown');
  assert.equal(data.index.d[1]._statusDate,'');
});
test('failed status fetch remains unknown while verified legacy demolition still hides only complete predecessors',async()=>{
  const rows=[{i:1,r:0,g:'시',d:'동',j:'1',bs:'멸실'},{i:2,r:0,g:'시',d:'동',j:'2'}],view=browser(rows);
  view.applyLifecycleData(await view.loadLifecycleData('','version'));
  assert.ok(rows.every(r=>r._status==='unknown'&&!r._hiddenInactive));
  view.applyLifecycleData({status:{version:2,sites:{[key(rows[0])]:{status:'demolished'}}},relations:{relations:[]}});
  assert.equal(rows[0]._hiddenInactive,true);
  assert.equal(rows[1]._status,'active');
  view.applyLifecycleData({status:{version:2,sites:{[key(rows[0])]:{status:'demolished'}}},relations:{relations:[{predecessors:[{siteKey:key(rows[0]),scope:'partial'}],successors:[]}]}});
  assert.equal(rows[0]._hiddenInactive,false);
});
