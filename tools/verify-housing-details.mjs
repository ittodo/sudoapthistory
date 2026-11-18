import {contractArchiveInputs,verifyContractArchive} from './verify-contract-archive.mjs';
import {readHashed} from './file-hash-memo.mjs';
import {ValidationSession} from './validation-session.mjs';
import {partitionDependencies} from '../js/housing-partition.mjs';
import{readFileSync,lstatSync}from'node:fs';import{join}from'node:path';import{gunzipSync}from'node:zlib';import{createHash}from'node:crypto';import{regionalReader}from'./regional-data.mjs';import{restoreDetails,contractDisplay}from'../js/housing-contract-detail.mjs';import*as codec from'../js/generated/housing-columns.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function verifyHousingDetails(root){
 const safe=p=>{let x=root;for(const part of p.split('/')){if(!part||part==='.'||part==='..'||/[\\:]/.test(part))throw Error('Unsafe contract path');x=join(x,part);if(lstatSync(x).isSymbolicLink())throw Error('Contract symlink');}return x;};
 const session=new ValidationSession(root,{roots:['tools/verify-housing-details.mjs']});
 const manifest=JSON.parse(readFileSync(safe('data/contracts/index.json'))),rent=JSON.parse(readFileSync(safe('data/apartment-rent/index.json'))),rental=regionalReader(root,'rental');
 if(manifest.schema!==2||rent.schema!==2||manifest.rentalVersion!==rental.manifest.version||rent.rentalVersion!==rental.manifest.version||rent.contractsHash!==hash(readFileSync(safe('data/contracts/index.json')))||rent.catalogHash!==hash(readFileSync(safe('data/apartments/index.json'))))throw Error('Detail manifest binding mismatch');
 // Archive source hashes are checked on every call; a receipt skips only decoding.
 if(rent.contractArchive)session.check('contract-archive',contractArchiveInputs(root,rent.contractArchive),()=>verifyContractArchive(root,rent.contractArchive));
 const read=p=>{const{bytes:b,digest,size}=readHashed(safe(p));if(size>25*1024*1024||digest!==manifest.sources[p])throw Error('Contract hash/size mismatch');return p.endsWith('.bin')?new Uint8Array(gunzipSync(b)):JSON.parse(b);};let count=0,unmatched=0;const expected=new Set(),displayUsage=new Map();
 const bundles=new Map();
 for(const p of manifest.partitions){if(p.format!=='regional-reference'){
  // Officetel months may name a regional bundle; each bundle month belongs to exactly one partition.
  const officetel=['officetel-sale','officetel-rent'].includes(p.service);let bundled=null;
  if(p.bundle!==undefined){if(!officetel||typeof p.bundle!=='string'||!/^\d{5}$/.test(p.lawd)||!/^\d{6}$/.test(p.month)||!/^(recent|\d{4})\.json$/.test(p.bundle.split('/')[2]||'')||p.bundle!==`${p.service}/${p.lawd}/${p.bundle.split('/')[2]}`)throw Error('Invalid contract bundle');const path='data/contracts/'+p.bundle;expected.add(path);if(!bundles.has(path))bundles.set(path,{value:read(path),used:new Set()});const entry=bundles.get(path);bundled=entry.value.months?.[p.month];if(!Array.isArray(bundled)||bundled.length!==p.count||entry.used.has(p.month)||bundled.some(r=>r.date.replaceAll('-','').slice(0,6)!==p.month))throw Error('Contract bundle mismatch');entry.used.add(p.month);}
  if(p.path===null){if(!officetel||(bundled===null&&p.count!==0))throw Error('Invalid empty contract partition');continue;}
  const path='data/contracts/'+p.path;expected.add(path);const value=read(path);if(value.rows.length!==p.count||(bundled&&JSON.stringify(value.rows)!==JSON.stringify(bundled)))throw Error('Contract count mismatch');continue;}
  const prefix=`data/contracts/${p.service}/${p.lawd}/${p.month}`;if(!['apartment-rent','rowhouse-rent'].includes(p.service)||!/^\d{5}$/.test(p.lawd)||!/^\d{6}$/.test(p.month)||(p.details!==null&&p.details!==prefix+'-details.bin')||(p.unmatched!==null&&p.unmatched!==prefix+'-unmatched.bin')||(p.display!==null&&p.display!==`data/contracts/${p.service}/${p.lawd}/display.json`)||((p.details===null)!==(p.display===null))||!Array.isArray(p.regionCodes)||new Set(p.regionCodes).size!==p.regionCodes.length)throw Error('Invalid contract scope');
  for(const path of [p.details,p.unmatched,p.display].filter(Boolean))expected.add(path);const d=p.details?read(p.details):codec.encodeColumns(codec.schemas.ContractDetail,[]),u=p.unmatched?read(p.unmatched):codec.encodeColumns(codec.schemas.ContractUnmatched,[]),meta=p.display?read(p.display):{refs:{},dictionary:[]},display=(()=>{if(!p.display)return {};if(!displayUsage.has(p.display))displayUsage.set(p.display,{meta,used:new Set()});return contractDisplay(d,meta,codec,displayUsage.get(p.display).used);})();
  const month=p.month.slice(0,4)+'-'+p.month.slice(4),dependencies={partition:hash(JSON.stringify(p))};
  for(const path of [p.details,p.unmatched,p.display].filter(Boolean))dependencies[path]=manifest.sources[path];
  // Identity files are hash-checked here and form a separate append-only receipt condition.
  const identities=[];for(const code of p.regionCodes){const region=rental.table.regions.get(code),entry=region?.entry;if(!entry)throw Error('Unknown contract region');rental.physical(entry.identities,false);identities.push({path:entry.identities,value:region.identity});for(const path of [rental.manifest.regional.quarters[code]?.[month]].filter(Boolean))for(const dep of partitionDependencies(path,rental.manifest.sources)){rental.physical(dep,false);dependencies[dep]=rental.manifest.sources[dep];}}
  const checked=session.check('rental-detail/'+p.service+'/'+p.lawd+'/'+p.month,dependencies,()=>{const facts=p.regionCodes.flatMap(code=>rental.regionMonth(code,month,false).rows),rows=restoreDetails(d,u,display,facts,rental.table,codec);if(rows.length!==p.count||rows.some(r=>r.date.replaceAll('-','').slice(0,6)!==p.month))throw Error('Contract detail count/month mismatch');return {status:'PASS',count:rows.length,unmatched:codec.openColumns(codec.schemas.ContractUnmatched,u).rowCount};},{identities});count+=checked.count;unmatched+=checked.unmatched;
 }
 for(const{value,used}of bundles.values())if(Object.keys(value.months||{}).length!==used.size)throw Error('Orphan contract bundle month');
 for(const{meta,used}of displayUsage.values())if(used.size!==Object.keys(meta.refs).length)throw Error('Orphan regional display metadata');
 if(expected.size!==Object.keys(manifest.sources).length||Object.keys(manifest.sources).some(p=>!expected.has(p)))throw Error('Orphan contract source');session.flush();return {schema:2,status:'PASS',contracts:count,unmatched,files:expected.size,validation:session.stats,validationMisses:session.misses,validationCacheStatus:session.cacheStatus};
}
