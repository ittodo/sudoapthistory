import {ValidationSession} from './validation-session.mjs';
import{partitionDependencies}from'../js/housing-partition.mjs';
import{readFileSync,lstatSync}from'node:fs';import{join}from'node:path';import{gunzipSync}from'node:zlib';import{createHash}from'node:crypto';import{regionalReader}from'./regional-data.mjs';import{restoreSaleReferences,excludedSaleRows}from'../js/housing-sale-detail.mjs';import*as codec from'../js/generated/housing-columns.mjs';
import {hashFile,readHashed} from './file-hash-memo.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function verifyHousingSales(root){
 const safe=p=>{let x=root;for(const s of p.split('/')){if(!s||s==='.'||s==='..'||/[\\:]/.test(s))throw Error('Unsafe sale detail path');x=join(x,s);if(lstatSync(x).isSymbolicLink())throw Error('Sale detail symlink');}return x;};
 const session=new ValidationSession(root,{roots:['tools/verify-housing-sales.mjs']});
 const manifest=JSON.parse(readFileSync(safe('data/sale-details/index.json'))),shared=regionalReader(root,'daily'),expected=new Set(),factSources=new Set();let rows=0,excludedCount=0;
 if(manifest.schema!==1||manifest.format!=='sale-fact-references'||!manifest.sources||!manifest.facts)throw Error('Invalid sale references');
 // Hash and size checks run on every call. Reading and decompression for a
 // year reference wait for an actual check; a memo hit avoids a second hash.
 const checkFile=(p,value)=>{if(value.size>25*1024*1024||value.digest!==manifest.sources[p])throw Error('Sale reference digest/size mismatch');return value;};
 const verify=p=>{expected.add(p);checkFile(p,hashFile(safe(p)));};
 const read=p=>{expected.add(p);return new Uint8Array(gunzipSync(checkFile(p,readHashed(safe(p))).bytes));};
 for(const[code,years]of Object.entries(manifest.regions)){if(!/^\d{5}$/.test(code)||!shared.table.regions.has(code))throw Error('Invalid sale region');const extraPath=manifest.excluded?.[code];let extra=[];
  if(extraPath){if(extraPath!==`data/sale-details/${code}/excluded.bin`)throw Error('Excluded sale path');extra=excludedSaleRows(read(extraPath),shared.table,codec,code);excludedCount+=extra.length;}
  const usedExcluded=new Set();factSources.add(shared.table.regions.get(code).entry.identities);
  for(const[year,path]of Object.entries(years)){if(!/^\d{4}$/.test(year)||path!==`data/sale-details/${code}/${year}.bin`)throw Error('Invalid sale year');const facts=[];
   const dependencies={months:hash(JSON.stringify(shared.manifest.months.filter(m=>m.startsWith(year))))};
   verify(path);dependencies[path]=manifest.sources[path];
   // The identity file is hash-checked here and is a separate append-only receipt condition.
   const region=shared.table.regions.get(code),identity=region.entry.identities;shared.physical(identity,false);
   if(extraPath)dependencies[extraPath]=manifest.sources[extraPath];
   for(const month of shared.manifest.months.filter(m=>m.startsWith(year))){const p=shared.manifest.regional.quarters[code]?.[month];if(p)for(const dep of partitionDependencies(p,shared.manifest.sources)){factSources.add(dep);shared.physical(dep,false);dependencies[dep]=shared.manifest.sources[dep];}}
   const checked=session.check('sale/'+code+'/'+year,dependencies,()=>{const referenceBytes=read(path);
    for(const month of shared.manifest.months.filter(m=>m.startsWith(year)))facts.push(...shared.regionMonth(code,month,false).rows);
    const extraYear=extra.filter(f=>String(f[1]).startsWith(year)),base=new Set(facts.map(f=>f[10]));if(extraYear.some(f=>base.has(f[10])))throw Error('Excluded sale duplicates common fact');facts.push(...extraYear);
    const restored=restoreSaleReferences(referenceBytes,facts,shared.table,codec,code);let count=0;const excluded=new Set();for(const group of restored.values())for(const row of group){if(!String(row.date).startsWith(year))throw Error('Sale reference year mismatch');count++;if(!base.has(row.identity))excluded.add(row.identity);}
    return {status:'PASS',rows:count,excluded:[...excluded]};
   },{identities:[{path:identity,value:region.identity}]});rows+=checked.rows;for(const id of checked.excluded)usedExcluded.add(id);
  }
  if(extra.some(f=>!usedExcluded.has(f[10])))throw Error('Orphan excluded sale');
 }
 if(Object.keys(manifest.excluded||{}).some(c=>!manifest.regions[c])||Object.keys(manifest.sources).length!==expected.size||Object.keys(manifest.sources).some(p=>!expected.has(p)))throw Error('Orphan sale source');
 if(Object.keys(manifest.facts).length!==factSources.size||Object.keys(manifest.facts).some(p=>!factSources.has(p)||manifest.facts[p]!==shared.manifest.sources[p]))throw Error('Sale/common binding mismatch');
 session.flush();return {status:'PASS',rows,excluded:excludedCount,files:expected.size,validation:session.stats,validationMisses:session.misses,validationCacheStatus:session.cacheStatus};
}
