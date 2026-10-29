// Sparse contract fields complement shared facts; no date, area or price copy.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {regionalReader} from './regional-reader.mjs';
import {packContractDetails} from '../js/housing-contract-detail.mjs';
import * as codec from '../js/generated/housing-columns.mjs';
import {detailMemo,detailEngine,detailDependencies,detailIdentity} from './housing-detail-cache.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const rawDigest=records=>hash(JSON.stringify(records.map(r=>JSON.stringify([r.lawd,r.value])).sort()));
function monthName(value){
 if(typeof value!=='string'||!/^\d{4}(0[1-9]|1[0-2])$/.test(value))throw Error('Invalid contract archive month');
 return value.slice(0,4)+'-'+value.slice(4);
}
export function buildContractArchive({packed,database,generationSession=null}){
 const started=performance.now(),timings={},regionMetrics=[];
 let context={phase:'setup'},regionStarted=started,regionBefore=null,sourceMode=null;
 const measured=(name,fn)=>{const start=performance.now(),parent=context;context={...parent,phase:name};try{return fn();}catch(error){error.archiveContext??={...context};throw error;}finally{timings[name]=(timings[name]??0)+(performance.now()-start)/1000;context=parent;}};
 const progress=(event,fields)=>console.error(JSON.stringify({event,at:new Date().toISOString(),...fields}));
 const reader=regionalReader(packed,'rental',{verifyOnce:true}),db=new DatabaseSync(database,{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN');
 const query=db.prepare("SELECT lawd,month,payload FROM contract_record INDEXED BY contract_record_entity WHERE entity_id=? AND service=? ORDER BY lawd,month,ordinal");
 const monthQuery=db.prepare("SELECT entity_id,lawd,month,payload FROM contract_record WHERE service=? AND lawd=? AND month=? ORDER BY ordinal");
 const archive={schema:1,sources:{},regions:{},districts:{},rows:0,sourceServices:{},coverageServices:{}},coverage={},rowhouseCoverage={};
 const stats={built:0,reused:0,monthsBuilt:0,monthsReused:0,sourceQueries:0,sourceRowsRead:0,sourcePayloadsParsed:0,decodedMonths:0,rawHashCalls:0,rawHashRows:0};
 const digestRecords=records=>measured('rawHash',()=>{stats.rawHashCalls++;stats.rawHashRows+=records.length;return rawDigest(records);});
 const regionDone=status=>{const metrics={region:context.region,sourceMode,status,seconds:(performance.now()-regionStarted)/1000,counters:Object.fromEntries(Object.entries(stats).map(([key,value])=>[key,value-regionBefore.stats[key]])),timings:Object.fromEntries(Object.entries(timings).map(([key,value])=>[key,value-(regionBefore.timings[key]??0)]))};regionMetrics.push(metrics);progress('contract_archive_region',metrics);};
 const cache=generationSession?.checkpoint?dirname(generationSession.checkpoint):null,engine=detailEngine('build-contract-archive.mjs');
 const changes=generationSession?.batch?.batches?.filter(b=>b.seq>(generationSession.old?.seq??0)).flatMap(b=>JSON.parse(b.payload).rentalPartitions??[])??[];
 const emit=(p,b)=>measured('outputWrite',()=>{mkdirSync(dirname(join(packed,p)),{recursive:true});writeFileSync(join(packed,p),b);archive.sources[p]=hash(b);});
 function sourceRows(ids,month=null,priorDistricts={},affected=[]){
  return measured('sourceReadAndParse',()=>{
  const raw=new Map();
  const add=(r,source)=>{const key=monthName(r.month);if(!raw.has(key))raw.set(key,[]);raw.get(key).push({value:{...JSON.parse(r.payload),entityId:source},lawd:r.lawd});stats.sourcePayloadsParsed++;};
  if(month===null)for(const source of ids){
   const start=performance.now();stats.sourceQueries++;
   for(const r of query.iterate(source,archive.sourceServices[source]??'apartment-rent')){
    if(performance.now()-start>30000)throw Error(`Contract source query exceeded 30 seconds (region=${context.region}, source=${source}, service=${archive.sourceServices[source]??'apartment-rent'})`);
    stats.sourceRowsRead++;add(r,source);
   }
  }else{
   // The existing primary key selects one service/district/month. Filtering an
   // entity-only index by month would still scan each source's full history.
   const selected=new Set(ids),routes=new Map(),route=(service,lawd)=>{if(!/^\d{5}$/.test(lawd))throw Error('Invalid contract archive district');if(!routes.has(service))routes.set(service,new Set());routes.get(service).add(lawd);};
   for(const id of ids)for(const lawd of priorDistricts[id]??[])route(archive.sourceServices[id]??'apartment-rent',lawd);
   const services=new Set(ids.map(id=>archive.sourceServices[id]??'apartment-rent'));
   for(const p of affected)if(monthName(p.month)===month)for(const service of services)route(service,p.lawd);
   for(const[service,districts]of routes)for(const lawd of districts){
    const start=performance.now();stats.sourceQueries++;
    for(const r of monthQuery.iterate(service,lawd,month.replace('-',''))){
     if(performance.now()-start>30000)throw Error(`Contract source query exceeded 30 seconds (region=${context.region}, month=${month}, service=${service}, lawd=${lawd})`);
     stats.sourceRowsRead++;if(selected.has(r.entity_id)&&(archive.sourceServices[r.entity_id]??'apartment-rent')===service)add(r,r.entity_id);
    }
   }
  }
  return raw;
  });
 }
 try{
  measured('coverageRead',()=>{
  for(const r of db.prepare("SELECT lawd,month,checked_at FROM contract_partition WHERE service='apartment-rent' ORDER BY lawd,month").iterate())(coverage[r.lawd]??={})[r.month]=r.checked_at;
  for(const r of db.prepare("SELECT lawd,month,checked_at FROM contract_partition WHERE service='rowhouse-rent' ORDER BY lawd,month").iterate())(rowhouseCoverage[r.lawd]??={})[r.month]=r.checked_at;
  });
  const sourceTypes=new Map(Object.values(reader.table.complexes).map(v=>[v.id,v.property_type??'apartment']));
  for(const [id,kind]of sourceTypes)if(kind==='rowhouse')archive.sourceServices[id]='rowhouse-rent';
  for(const[code,region]of reader.table.regions){const ids=region.identity.complexes,path=`data/contracts/apartment-rent/${code}/archive-details.bin`,scope='contract-archive/'+code;
   context={region:code,phase:'regionSetup'};regionStarted=performance.now();regionBefore={stats:{...stats},timings:{...timings}};
   const dependencies=Object.entries(reader.manifest.sources).filter(([p])=>p.startsWith('data/daily/regions/'+code+'/quarters/'));
   const selected=new Set(ids),affected=changes.filter(p=>!Array.isArray(p.sources)||p.sources.some(s=>selected.has(s))),old=generationSession?.peek(scope);
   const dirty=!old||affected.length>0;
   const token=dirty?generationSession?.batch?.seq??0:old.result.token;
   const services=ids.map(id=>archive.sourceServices[id]??'apartment-rent');
   const sourceKey=hash(JSON.stringify([ids,services])),previous=old?.result.sourceKey===sourceKey?old.result.months:null;
   sourceMode=services.includes('rowhouse-rent')?'full-rowhouse-snapshot':previous?'batch-months':'first-baseline';
   progress('contract_archive_region_start',{region:code,sourceMode,sources:ids.length});
   // Rental batch metadata currently tracks apartment contracts only. For a
   // region with rowhouse sources, bind reuse to the actual source snapshot.
   let baseline=services.includes('rowhouse-rent')?sourceRows(ids):null;
   // Retain this invocation's immutable baseline digests for the month keys.
   // The independent pre-pack source check below still recomputes the digest.
   const baselineHashes=new Map();
   const sourceSnapshot=baseline?[...baseline].sort(([a],[b])=>a.localeCompare(b)).map(([month,records])=>{const digest=digestRecords(records);baselineHashes.set(month,digest);return[month,digest];}):null;
   const key=[3,ids,services,dependencies,reader.manifest.regional.quarters?.[code]??null,token,...(sourceSnapshot?[sourceSnapshot]:[])],identity={[code]:{complexes:ids,areas:region.identity.areas}};
   const hit=measured('regionCacheLoad',()=>generationSession?.load(scope,key,identity,p=>p===path,emit));
   if(hit){archive.regions[code]=path;Object.assign(archive.districts,hit.districts);archive.rows+=hit.rows;stats.reused++;stats.monthsReused+=Object.keys(hit.months).length;regionDone('reused');continue;}
   // Apartment-only regions query changed months after their first build.
   // Private month files never enter the public manifest or move the consumer cursor.
   if(!previous&&!baseline)baseline=sourceRows(ids);
   const changedMonths=new Set(affected.map(p=>monthName(p.month)));
   const months=[...new Set([...Object.keys(previous??{}),...(baseline?.keys()??[]),...changedMonths])].sort();
   const rows=[],districts={},monthResults={},monthIdentity=detailIdentity(reader.table,[code]);
   for(const month of months){
    context={region:code,month,phase:'monthSetup'};const monthStarted=performance.now();
    const prior=previous?.[month],monthToken=!prior||changedMonths.has(month)?generationSession?.batch?.seq??0:prior.token;
    const monthDependencies=detailDependencies(reader,code,[month]);let facts;
    const loadFacts=()=>{if(!facts){facts=measured('factRead',()=>reader.regionMonth(code,month,false).rows);stats.decodedMonths++;}return facts;};
    const factHash=prior&&same(prior.dependencies,monthDependencies)?prior.factHash:measured('factHash',()=>hash(JSON.stringify(loadFacts())));
    let records=baseline?baseline.get(month)??[]:null;
    const loadRecords=()=>records??=sourceRows(ids,month,old.result.districts,affected).get(month)??[];
    // A missing/incomplete accepted chain can repeat a sequence number. Bind
    // its baseline to current raw content, not just that sequence and facts.
    const rawHash=baseline?(baselineHashes.get(month)??digestRecords(loadRecords())):prior&&!changedMonths.has(month)?prior.rawHash:digestRecords(loadRecords());
    const cached=measured('monthCacheReadBuildWrite',()=>detailMemo(cache,[3,engine,'contract-archive',code,month,ids,services,monthToken,factHash,rawHash],monthIdentity,p=>p==='month.bin',()=>{
     const currentFacts=loadFacts(),actualFactHash=measured('factHash',()=>hash(JSON.stringify(currentFacts)));if(actualFactHash!==factHash)throw Error(`Contract archive month facts changed (region=${code}, month=${month}, expected=${factHash}, actual=${actualFactHash})`);
     const currentRecords=loadRecords(),monthDistricts={},actualRawHash=digestRecords(currentRecords);if(actualRawHash!==rawHash)throw Error(`Contract archive month source changed without a batch (region=${code}, month=${month}, expected=${rawHash}, actual=${actualRawHash})`);
     for(const {value,lawd} of currentRecords)(monthDistricts[value.entityId]??=new Set()).add(lawd);
     const detail=measured('detailPack',()=>packContractDetails(currentRecords.map(r=>r.value),currentFacts,reader.table,codec));
     return {result:{rows:detail.matched,districts:Object.fromEntries(Object.entries(monthDistricts).map(([id,d])=>[id,[...d].sort()]))},files:new Map([['month.bin',detail.details]])};
    }));
    if(cached.reused)stats.monthsReused++;else stats.monthsBuilt++;
    measured('monthDecode',()=>{const view=codec.openColumns(codec.schemas.ContractDetail,cached.files.get('month.bin'));
    for(let i=0;i<view.rowCount;i++)rows.push(view.row(i));
    });
    for(const[id,values]of Object.entries(cached.result.districts))for(const lawd of values)(districts[id]??=new Set()).add(lawd);
    monthResults[month]={token:monthToken,dependencies:monthDependencies,factHash,rawHash};
    const seconds=(performance.now()-monthStarted)/1000;if(seconds>=5)progress('contract_archive_slow_month',{region:code,month,seconds,reused:cached.reused});
   }
   context={region:code,phase:'regionAssembly'};
   measured('regionEncode',()=>{rows.sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]);emit(path,gzipSync(codec.encodeColumns(codec.schemas.ContractDetail,rows),{level:6}));});archive.regions[code]=path;archive.rows+=rows.length;
   const sourceDistricts=Object.fromEntries(ids.filter(id=>districts[id]).map(id=>[id,[...districts[id]].sort()]));Object.assign(archive.districts,sourceDistricts);measured('regionCacheSave',()=>generationSession?.save(scope,key,identity,{token,sourceKey,rows:rows.length,districts:sourceDistricts,months:monthResults},[path]));stats.built++;regionDone('built');
  }
 }catch(error){progress('contract_archive_failed',{...(error.archiveContext??context),sourceMode,seconds:(performance.now()-started)/1000,counters:stats,timings,errorType:error.name});throw error;
 }finally{db.exec('ROLLBACK');db.close();}
 const path='data/contracts/apartment-rent/coverage.bin';emit(path,gzipSync(Buffer.from(JSON.stringify(coverage)),{level:6}));archive.coverageRef={path,sha256:archive.sources[path]};
 if(Object.keys(archive.sourceServices).length){const path='data/contracts/rowhouse-rent/coverage.bin';emit(path,gzipSync(Buffer.from(JSON.stringify(rowhouseCoverage)),{level:6}));archive.coverageServices['rowhouse-rent']={path,sha256:archive.sources[path]};}
 const indexPath=join(packed,'data/apartment-rent/index.json'),rent=JSON.parse(readFileSync(indexPath));rent.contractArchive=archive;writeFileSync(indexPath,JSON.stringify(rent));return {rows:archive.rows,files:Object.keys(archive.sources).length,...stats,seconds:(performance.now()-started)/1000,timings,regionMetrics};
}
