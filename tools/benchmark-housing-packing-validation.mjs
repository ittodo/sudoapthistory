// Bounded read-only segment diagnostic. No DB, stage, or published file is written.
import{readFileSync,writeFileSync,mkdtempSync,rmSync,realpathSync}from'node:fs';
import{join,resolve}from'node:path';import{tmpdir}from'node:os';import{spawnSync}from'node:child_process';
import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';import{gunzipSync}from'node:zlib';
import{performance}from'node:perf_hooks';import assert from'node:assert/strict';
import{packedMemo}from'./housing-packing-cache.mjs';import{decodeQuarter}from'../js/housing-quarter.mjs';
import*as codec from'../js/generated/housing-columns.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
if(process.argv[2]!=='--worker'){
 const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',...process.argv.slice(2)],{timeout:30000,encoding:'utf8',maxBuffer:1024*1024});
 if(child.error||child.status!==0){console.error(child.stderr);console.log(JSON.stringify({status:'SEGMENT_STOPPED',budgetSeconds:30,error:child.error?.message||'Diagnostic failed'}));process.exitCode=1;}
 else process.stdout.write(child.stdout);
}else{
 const root=realpathSync(process.argv[3]),report=resolve(process.argv[4]);
 if(report.startsWith(root))throw Error('Report must be outside published input');
 const manifestBytes=readFileSync(join(root,'data/daily/index.json')),m=JSON.parse(manifestBytes);
 const paths=[...new Set(Object.values(m.regional.quarters).flatMap(Object.values))].filter(p=>p.endsWith('.bin'));
 const candidate=paths.map(p=>[p,readFileSync(join(root,p))]).sort((a,b)=>b[1].length-a[1].length)[0];
 if(!candidate)throw Error('Unpartitioned quarter required');
 const [path,bytes]=candidate;if(digest(bytes)!==m.sources[path])throw Error('Input digest mismatch');
 const code=path.split('/')[3],quarter=path.split('/').at(-1).slice(0,-4);
 const descPath=m.regional.authority,descBytes=readFileSync(join(root,descPath));if(digest(descBytes)!==m.sources[descPath])throw Error('Authority digest mismatch');
 const idPath=JSON.parse(descBytes).regions[code].identities,idBytes=readFileSync(join(root,idPath));if(digest(idBytes)!==m.sources[idPath])throw Error('Identity digest mismatch');
 const identity=JSON.parse(idBytes),expected=decodeQuarter(gunzipSync(bytes),identity,codec,{lawd:code,quarter}),months=Object.keys(m.regional.quarters[code]).filter(month=>m.regional.quarters[code][month]===path);
 const key=[digest(readFileSync(fileURLToPath(import.meta.url))),code,quarter,digest(bytes),digest(idBytes)];
 const cache=mkdtempSync(join(tmpdir(),'housing-pack-bench-'));const beforeFull=process.env.NODO_FULL_VERIFY;delete process.env.NODO_FULL_VERIFY;
 try{
  let validations=0,emitted=null;const make=emit=>{emit(path,bytes);return{path,files:1,bytes:bytes.length};};
  const validate=(r,files)=>{validations++;const actual=decodeQuarter(gunzipSync(files.get(path)),identity,codec,{lawd:code,quarter});for(const month of months)assert.deepEqual(actual.month(month),expected.month(month));};
  const emit=(p,b)=>{assert.equal(p,path);emitted=digest(b);};
  const seed=performance.now();packedMemo(cache,key,make,validate,emit,{reuseValidation:true});const seedSeconds=(performance.now()-seed)/1000;
  const measure=reuseValidation=>{const t=performance.now();const r=packedMemo(cache,key,make,validate,emit,{reuseValidation});assert.equal(emitted,digest(bytes));return{seconds:(performance.now()-t)/1000,validationReused:r.validationReused};};
  const pairs=Array.from({length:3},()=>({baseline:measure(false),candidate:measure(true)}));
  const median=xs=>xs.sort((a,b)=>a-b)[1],baseline=median(pairs.map(p=>p.baseline.seconds)),candidate=median(pairs.map(p=>p.candidate.seconds));
  assert.equal(digest(readFileSync(join(root,path))),m.sources[path]);assert.deepEqual(readFileSync(join(root,'data/daily/index.json')),manifestBytes);
  const result={status:candidate<=baseline*.8?'PASS_SEGMENT_TARGET':'PERFORMANCE_STOPPED',productionChanged:false,fullPrepareMeasured:false,path,bytes:bytes.length,months,seedSeconds,pairs,baselineMedianSeconds:baseline,candidateMedianSeconds:candidate,reduction:1-candidate/baseline,validations,budgetSeconds:30};
  writeFileSync(report,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{if(beforeFull===undefined)delete process.env.NODO_FULL_VERIFY;else process.env.NODO_FULL_VERIFY=beforeFull;rmSync(cache,{recursive:true});}
}
