// Offline migration evidence only. The public runtime never translates legacy IDs.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {regionalReader} from './regional-data.mjs';
import {regionModels,saleFrames,rentalFrames} from './build-region-price-cache.mjs';
import {combineCatalogs} from './build-search-data.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=(root,p)=>{const bytes=readFileSync(join(root,p));return JSON.parse(p.endsWith('.bin')?gunzipSync(bytes):bytes);};
function equal(a,b,path='result'){if(typeof a==='number'&&typeof b==='number'){if(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b)))return;if(Object.is(a,b))return;throw Error('Numeric difference at '+path+': '+a+' / '+b);}if(Array.isArray(a)||Array.isArray(b)){if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)throw Error('Array difference at '+path);a.forEach((v,i)=>equal(v,b[i],path+'/'+i));return;}if(a&&typeof a==='object'||b&&typeof b==='object'){const ak=Object.keys(a||{}).sort(),bk=Object.keys(b||{}).sort();if(JSON.stringify(ak)!==JSON.stringify(bk))throw Error('Fields differ at '+path);ak.forEach(k=>equal(a[k],b[k],path+'/'+k));return;}if(a!==b)throw Error('Value difference at '+path+': '+a+' / '+b);}
function sorted(value){if(Array.isArray(value)){let v=value.map(sorted);if(v.every(x=>Array.isArray(x)&&typeof x[0]==='string'))v.sort((a,b)=>a[0].localeCompare(b[0]));return v;}if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sorted(v)]));return value;}
export function compareMigration(oldRoot,newRoot,codeRoot,{months,configuration=resolve(codeRoot,'../15_26/data/regional_transactions.json')}={}){
 oldRoot=resolve(oldRoot);newRoot=resolve(newRoot);codeRoot=resolve(codeRoot);const start=performance.now();
 const sale=regionalReader(oldRoot,'daily'),rent=regionalReader(oldRoot,'rental'),nextSale=regionalReader(newRoot,'daily'),nextRent=regionalReader(newRoot,'rental');
 if(sale.manifest.schema!==1||rent.manifest.schema!==1||nextSale.manifest.schema!==2||nextRent.manifest.schema!==2)throw Error('Initial schema1 to fixed-region comparison required');
 const baseline=nextSale.manifest.regional.baselineCommit,git=execFileSync('git',['-c','safe.directory='+oldRoot.replaceAll('\\','/'),'rev-parse','HEAD'],{cwd:oldRoot,encoding:'utf8'}).trim();if(git!==baseline){
  const args=['-c','safe.directory='+oldRoot.replaceAll('\\','/')];
  execFileSync('git',[...args,'merge-base','--is-ancestor',baseline,'HEAD'],{cwd:oldRoot});
  const changed=execFileSync('git',[...args,'diff','--name-only',baseline,'HEAD','--','data'],{cwd:oldRoot,encoding:'utf8'}).trim();if(changed)throw Error('Reviewed baseline data changed after the frozen commit');
 }
 const dirty=execFileSync('git',['-c','safe.directory='+oldRoot.replaceAll('\\','/'),'status','--porcelain','--','data'],{cwd:oldRoot,encoding:'utf8'}).trim();if(dirty)throw Error('Baseline data worktree changed');
 const config=readFileSync(configuration);
 const configValue=JSON.parse(config);if(configValue.baselineCommit!==baseline)throw Error('Frozen baseline configuration mismatch');for(const kind of ['daily','rental'])if(hash(readFileSync(join(oldRoot,`data/${kind}/index.json`)))!==configValue.manifests[kind])throw Error('Baseline manifest not approved');
 const current=nextSale.catalog,oldSales=sale.catalog,oldRental=rent.catalog;
 const complexKeys=oldSales.complexes.map(c=>current.source.get(c.id)),rentalKeys=oldRental.complexes.map(c=>current.source.get(c.id));if([...complexKeys,...rentalKeys].some(k=>!k))throw Error('Original source was removed');
 const areaKeys=oldSales.areas.map(([ci,area])=>{const ck=complexKeys[ci],[code,n]=ck.split(':'),exact=globalThis.NodoRegional.exactArea(area),region=current.regions.get(code).identity;const id=region.areas.findIndex(a=>a[0]===Number(n)&&a[1]===exact);if(id<0)throw Error('Original exact area was removed');return code+':'+id;});
 // Alias the old metadata by new keys inside this offline process, preserving both model inputs.
 const oldCatalog={areas:[],complexes:[]},oldRent=[];oldSales.complexes.forEach((c,i)=>oldCatalog.complexes[complexKeys[i]]=c);oldSales.areas.forEach((a,i)=>oldCatalog.areas[areaKeys[i]]=[complexKeys[a[0]],a[1]]);oldRental.complexes.forEach((c,i)=>{oldRent.push(c);oldRent[rentalKeys[i]]=c;});
 const ctx=regionModels(codeRoot);ctx.NodoRental.normalizeDistricts(oldRent);ctx.NodoRental.normalizeDistricts(nextRent.catalog.complexes);const map=read(oldRoot,'data/map/index.json');
 const translate=(shard,keys)=>Object.fromEntries(Object.entries(shard).map(([f,v])=>[f,Array.isArray(v)?v.map(row=>[keys[row[0]],...row.slice(1)]):v]));
 const selected=months||['2006-01','2011-01','2016-09','2021-09','2026-09'];let frames=0;
 for(const month of selected){for(const[r,code]of ['41','11','28'].entries()){
  if(sale.manifest.months.includes(month)){const p=`data/daily/${r}/${month}-state.bin`,before=translate(sale.read(p),areaKeys),after=nextSale.read(p);equal(sorted(saleFrames(ctx,oldCatalog,map,before,month)),sorted(saleFrames(ctx,current,map,after,month)),`sale/${month}/${code}`);frames++;}
  if(rent.manifest.months.includes(month)){const p=`data/rental/months/${month}-${code}-state.bin`,before=translate(rent.read(p),rentalKeys),after=nextRent.read(p);for(const type of ['jeonse','monthly']){equal(sorted(rentalFrames(ctx,oldRent,before,month,code,type)),sorted(rentalFrames(ctx,nextRent.catalog.complexes,after,month,code,type)),`rental/${month}/${code}/${type}`);frames++;}}
 }}
 const index=read(oldRoot,'data/index.json'),identities=read(oldRoot,'data/apartments/index.json'),metadata=read(oldRoot,'data/housing-v3/index.json'),options={rows:index.d,map:map.d,metadata:metadata.complexes,lookup:identities.lookup,ambiguous:identities.ambiguous};
 const before=combineCatalogs({...options,sale:oldSales.complexes,rental:oldRental.complexes}),after=combineCatalogs({...options,sale:current.complexes.filter(c=>c.hasSale!==false),rental:nextRent.catalog.complexes.filter(c=>c.hasRental!==false)});equal(before,after,'search/entities');
 return {status:'PASS',baselineCommit:baseline,reviewedCodeHead:git,configurationSha256:hash(config),legacyCompatibility:false,complexes:complexKeys.length,rentalSources:rentalKeys.length,exactAreas:areaKeys.length,priceFrameComparisons:frames,searchEntities:after.length,months:selected,seconds:(performance.now()-start)/1000,numericTolerance:'1e-8 relative for aggregation order only; native raw vectors compared exactly'};
}
if(process.argv[1]&&resolve(process.argv[1])===import.meta.filename){const[oldRoot,newRoot,codeRoot,output,configuration]=process.argv.slice(2);if(!oldRoot||!newRoot||!codeRoot||!output)throw Error('Usage: baseline fixed-output reviewed-code-root evidence.json');const result=compareMigration(oldRoot,newRoot,codeRoot,{configuration});writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
