// Sparse contract fields complement shared facts; no date, area or price copy.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {regionalReader} from './regional-reader.mjs';
import {packContractDetails} from '../js/housing-contract-detail.mjs';
import * as codec from '../js/generated/housing-columns.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function buildContractArchive({packed,database,generationSession=null}){
 const reader=regionalReader(packed,'rental',{verifyOnce:true}),db=new DatabaseSync(database,{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN');
 const query=db.prepare("SELECT lawd,month,payload FROM contract_record INDEXED BY contract_record_entity WHERE entity_id=? AND service=? ORDER BY lawd,month,ordinal");
 const archive={schema:1,sources:{},regions:{},districts:{},rows:0,sourceServices:{},coverageServices:{}},coverage={},rowhouseCoverage={},stats={built:0,reused:0};
 const emit=(p,b)=>{mkdirSync(dirname(join(packed,p)),{recursive:true});writeFileSync(join(packed,p),b);archive.sources[p]=hash(b);};
 try{
  for(const r of db.prepare("SELECT lawd,month,checked_at FROM contract_partition WHERE service='apartment-rent' ORDER BY lawd,month").iterate())(coverage[r.lawd]??={})[r.month]=r.checked_at;
  for(const r of db.prepare("SELECT lawd,month,checked_at FROM contract_partition WHERE service='rowhouse-rent' ORDER BY lawd,month").iterate())(rowhouseCoverage[r.lawd]??={})[r.month]=r.checked_at;
  const sourceTypes=new Map(Object.values(reader.table.complexes).map(v=>[v.id,v.property_type??'apartment']));
  for(const [id,kind]of sourceTypes)if(kind==='rowhouse')archive.sourceServices[id]='rowhouse-rent';
  for(const[code,region]of reader.table.regions){const ids=region.identity.complexes,path=`data/contracts/apartment-rent/${code}/archive-details.bin`,scope='contract-archive/'+code;
   const dependencies=Object.entries(reader.manifest.sources).filter(([p])=>p.startsWith('data/daily/regions/'+code+'/quarters/'));
   const changes=generationSession?.batch?.batches?.filter(b=>b.seq>(generationSession.old?.seq??0))??[],old=generationSession?.peek(scope);
   const dirty=!old||changes.some(b=>JSON.parse(b.payload).rentalPartitions?.some(p=>!Array.isArray(p.sources)||p.sources.some(s=>ids.includes(s))));
   const token=dirty?generationSession?.batch?.seq??0:old.result.token;
   const key=[2,ids,ids.map(id=>archive.sourceServices[id]??'apartment-rent'),dependencies,token],identity={[code]:{complexes:ids,areas:region.identity.areas}};
   const hit=generationSession?.load(scope,key,identity,p=>p===path,emit);
   if(hit){archive.regions[code]=path;Object.assign(archive.districts,hit.districts);archive.rows+=hit.rows;stats.reused++;continue;}
   const raw=new Map(),districts={};
   for(const source of ids){const start=performance.now();for(const r of query.iterate(source,archive.sourceServices[source]??'apartment-rent')){if(performance.now()-start>30000)throw Error('Contract source query exceeded 30 seconds');const month=r.month.slice(0,4)+'-'+r.month.slice(4);if(!raw.has(month))raw.set(month,[]);raw.get(month).push({...JSON.parse(r.payload),entityId:source});(districts[source]??=new Set()).add(r.lawd);}}
   const rows=[];
   for(const[month,values]of raw){const facts=reader.regionMonth(code,month,false).rows,packed=packContractDetails(values,facts,reader.table,codec),view=codec.openColumns(codec.schemas.ContractDetail,packed.details);for(let i=0;i<view.rowCount;i++)rows.push(view.row(i));}
   rows.sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]);emit(path,gzipSync(codec.encodeColumns(codec.schemas.ContractDetail,rows),{level:6}));archive.regions[code]=path;archive.rows+=rows.length;
   const sourceDistricts=Object.fromEntries(Object.entries(districts).map(([id,d])=>[id,[...d].sort()]));Object.assign(archive.districts,sourceDistricts);generationSession?.save(scope,key,identity,{token,rows:rows.length,districts:sourceDistricts},[path]);stats.built++;
  }
 }finally{db.exec('ROLLBACK');db.close();}
 const path='data/contracts/apartment-rent/coverage.bin';emit(path,gzipSync(Buffer.from(JSON.stringify(coverage)),{level:6}));archive.coverageRef={path,sha256:archive.sources[path]};
 if(Object.keys(archive.sourceServices).length){const path='data/contracts/rowhouse-rent/coverage.bin';emit(path,gzipSync(Buffer.from(JSON.stringify(rowhouseCoverage)),{level:6}));archive.coverageServices['rowhouse-rent']={path,sha256:archive.sources[path]};}
 const indexPath=join(packed,'data/apartment-rent/index.json'),rent=JSON.parse(readFileSync(indexPath));rent.contractArchive=archive;writeFileSync(indexPath,JSON.stringify(rent));return {rows:archive.rows,files:Object.keys(archive.sources).length,...stats};
}
