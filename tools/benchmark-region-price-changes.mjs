// Synthetic changes are allowed only in an explicitly isolated copied fixture.
import {readFileSync,writeFileSync,existsSync,mkdirSync,realpathSync,renameSync} from 'node:fs';
import {resolve,join,dirname,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {decodeQuarter,packQuarter,encodeQuarter} from '../js/housing-quarter.mjs';
import * as codec from '../js/generated/housing-columns.mjs';
import {regionPriceAssets} from './build-region-price-cache.mjs';
const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1];
if(!args.includes('--root')||!args.includes('--report'))throw Error('Explicit isolated --root and new --report required');
const root=realpathSync(resolve(get('--root'))),report=resolve(get('--report'));
const production=p=>{const n=p.replaceAll('\\','/').toLowerCase();return ['d:/work/sudoapthistory','d:/work/15_26'].some(base=>n===base||n.startsWith(base+'/'));};
if(production(root)||production(report)||production(realpathSync(dirname(report))))throw Error('Production root or report is forbidden for synthetic changes');
const fixture=JSON.parse(readFileSync(join(root,'fixture.json')));
if(fixture.isolated!==true||existsSync(report))throw Error('Isolated fixture and new report required');
const code='11110',month='2026-09',base='data/daily/regions/'+code;
const load=p=>JSON.parse(readFileSync(join(root,p))),identity=load(base+'/identities.json'),metadata=load(base+'/metadata.json'),payload=load('data/map/index.json');
const originals=new Map(),changes=[];
const save=(path,bytes)=>{if(!originals.has(path))originals.set(path,readFileSync(join(root,path)));writeFileSync(join(root,path),bytes);changes.push(path);};
const digest=b=>createHash('sha256').update(b).digest('hex');
function flush(path,value){save(path,Buffer.from(JSON.stringify(value)));}
function manifests(){for(const path of ['data/daily/index.json','data/rental/index.json']){const m=load(path);for(const p of new Set(changes))if(p in m.sources)m.sources[p]=digest(readFileSync(join(root,p)));flush(path,m);}}
function run(){const stats={},start=performance.now(),assets=regionPriceAssets(root,{stats,months:selectedMonths});return {seconds:(performance.now()-start)/1000,stats,assets:assets.filter(a=>a.path.endsWith('.bin')).map(a=>({path:a.path,sha256:a.sha256}))};}
function difference(a,b){const before=new Map(a.assets.map(x=>[x.path,x.sha256]));return b.assets.filter(x=>before.get(x.path)!==x.sha256).map(x=>x.path);}
const selectedMonths=args.includes('--months')?get('--months').split(','):undefined;
const output={scope:'isolated public input copy; never publish synthetic facts',fixture:root,months:selectedMonths||'all',scenarios:{}};
try{
 const baseline=run();output.scenarios.unchanged=baseline;
 const oldIdentity=structuredClone(identity),ci=identity.complexes.length,ai=identity.areas.length,id='replay-new-11110',exactArea='59.12345';
 identity.complexes.push(id);identity.areas.push([ci,exactArea]);metadata.complexes.push({...metadata.complexes.find(x=>x.coord),id,n:'REPLAY synthetic complex',mapId:id,publicId:id,hasSale:true,hasRental:false});
 payload.d.push({id,r:1,n:'REPLAY synthetic complex',admin:metadata.complexes.at(-1).admin});
 flush(base+'/identities.json',identity);flush(base+'/metadata.json',metadata);flush('data/map/index.json',payload);manifests();
 const added=run();added.changedPublicQuarters=difference(baseline,added);if(added.stats.computedGroups!==0||added.changedPublicQuarters.length)throw Error('Appending unused identities changed historic prices');output.scenarios.identityAddition=added;
 const manifest=load('data/daily/index.json'),quarter=manifest.regional.quarters[code][month];
 if(!quarter.endsWith('.bin'))throw Error('This controlled fixture requires a direct quarter');
 const opened=decodeQuarter(gunzipSync(readFileSync(join(root,quarter))),oldIdentity,codec,{lawd:code,quarter:'2026-Q3'}),months={};
 for(const m of ['2026-07','2026-08','2026-09'])months[m]=structuredClone(opened.month(m));
 // Use a single active trade on its own day: a +1 fact correction is also
 // exactly +1 in the day average/minimum/maximum, not an invented aggregate.
 const sample=months[month].daily.rows.find(row=>row[4]===0&&months[month].daily.updates.some(u=>u[0]===row[0]&&u[1]===row[1]&&u[5]===1&&u.slice(2,5).every(price=>price===row[2])));if(!sample)throw Error('No source fact for synthetic addition');
 const newFact=structuredClone(sample);newFact[0]=code+':'+ai;newFact[10]='ab'.repeat(11);months[month].daily.rows.push(newFact);
 const price=Number(newFact[2]);months[month].daily.updates.push([code+':'+ai,newFact[1],price,price,price,1]);months[month].daily.updates.sort((a,b)=>a[1]-b[1]);
 save(quarter,gzipSync(encodeQuarter(packQuarter(code,'2026-Q3',months,identity,codec)),{level:6}));manifests();
 const withTrade=run();withTrade.changedPublicQuarters=difference(added,withTrade);if(withTrade.stats.invalidationReasons.missing!==1||withTrade.stats.computedGroups!==1)throw Error('New trade recomputed unrelated groups');output.scenarios.newComplexTrade=withTrade;
 const oldRow=months[month].daily.updates.find(u=>u[0]===sample[0]&&u[1]===sample[1]);if(!oldRow)throw Error('No historical price update');oldRow[2]+=1;oldRow[3]+=1;oldRow[4]+=1;sample[2]+=1;sample[10]=digest(Buffer.from(JSON.stringify(sample))).slice(0,22);
 save(quarter,gzipSync(encodeQuarter(packQuarter(code,'2026-Q3',months,identity,codec)),{level:6}));manifests();
 const corrected=run();corrected.changedPublicQuarters=difference(withTrade,corrected);if(corrected.stats.computedGroups!==1||corrected.stats.invalidationReasons.inputs!==1)throw Error('Correction recomputed unrelated groups');output.scenarios.historicalCorrection=corrected;
 // Compare the changed quarter against the original calculation, using all its months.
 // Preserve earlier isolated reference evidence, but measure a cold reference.
 const referenceDirectory=join(root,'cloudflare/dist/region-price-reference-v1');
 if(existsSync(referenceDirectory)){
  if(realpathSync(referenceDirectory)!==referenceDirectory)throw Error('Linked reference output is forbidden');
  const archived=referenceDirectory+'.before-'+randomUUID();
  if(!resolve(archived).startsWith(root+sep)||realpathSync(dirname(archived))!==dirname(referenceDirectory))throw Error('Reference archive escapes isolated fixture');
  renameSync(referenceDirectory,archived);output.referenceCacheArchived=archived;
 }
 output.referenceCacheMode='cold';
 const referenceStarted=performance.now(),referenceStats={},reference=regionPriceAssets(root,{months:['2026-07','2026-08','2026-09'],reference:true,stats:referenceStats});
 output.referenceQuarterSeconds=(performance.now()-referenceStarted)/1000;output.referenceQuarterStats=referenceStats;
 const expected=new Map(reference.filter(a=>a.path.endsWith('.bin')).map(a=>[a.path,a.sha256]));
 output.changedQuarterDifferences=corrected.assets.filter(a=>expected.has(a.path)&&expected.get(a.path)!==a.sha256).map(a=>a.path);
 if(output.changedQuarterDifferences.length)throw Error('Changed quarter differs from original model');
 output.status='PASS';
}catch(error){output.status='FAIL';output.error=String(error);process.exitCode=1;}
finally{for(const[path,bytes]of originals)writeFileSync(join(root,path),bytes);output.inputsRestored=[...originals].every(([p,b])=>readFileSync(join(root,p)).equals(b));mkdirSync(resolve(report,'..'),{recursive:true});writeFileSync(report,JSON.stringify(output,null,2));console.log(JSON.stringify({...output,scenarios:Object.fromEntries(Object.entries(output.scenarios).map(([k,v])=>[k,{...v,assets:v.assets.length}]))}));}
