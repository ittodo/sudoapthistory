// Real stored native input, isolated output, 30-second total diagnostic budget.
import{spawnSync}from'node:child_process';import{readFileSync,writeFileSync,mkdtempSync,rmSync,realpathSync}from'node:fs';
import{join,resolve}from'node:path';import{fileURLToPath}from'node:url';import{tmpdir}from'node:os';
import{createHash}from'node:crypto';import{gunzipSync}from'node:zlib';import{performance}from'node:perf_hooks';import assert from'node:assert/strict';
import{buildHousingRegions}from'./build-housing-regions.mjs';import{scopedNativeMonth}from'./housing-native-adapter.mjs';
import*as codec from'../js/generated/housing-columns.mjs';import'../js/regional-data.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
if(process.argv[2]!=='--worker'){
 const c=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',...process.argv.slice(2)],{timeout:30000,encoding:'utf8',maxBuffer:1048576});
 if(c.error||c.status!==0){console.error(c.stderr);console.log(JSON.stringify({status:'SEGMENT_STOPPED',budgetSeconds:30,error:c.error?.message||'Diagnostic failed'}));process.exitCode=1;}else process.stdout.write(c.stdout);
}else{
 const[rootArg,scratchArg,code,year,reportArg]=process.argv.slice(3),root=realpathSync(rootArg),scratch=realpathSync(scratchArg),report=resolve(reportArg);
 if(!/^\d{5}$/.test(code)||!/^\d{4}$/.test(year)||!scratch.includes('regional-transaction-cache')||report.startsWith(root)||report.startsWith(scratch))throw Error('Read-only fixture and external report required');
 const checks=new Map();const json=(p,expected)=>{const b=readFileSync(p),h=hash(b);if(expected&&h!==expected)throw Error('Input digest mismatch');checks.set(p,h);return JSON.parse(p.endsWith('.bin')?gunzipSync(b):b);};
 const desc=json(join(root,'data/daily/regions/index.json')),entry=desc.regions[code],payloads={};for(const p of [entry.identities,entry.metadata])payloads[p]=json(join(root,p));
 const table=globalThis.NodoRegional.tables({...desc,regions:{[code]:entry}},payloads,'daily'),native={},readers={};let decoded=0;
 for(const kind of ['daily','rental']){
  const m=json(join(scratch,'data/'+kind+'/index.json'));native[kind]=m;const months=m.months.filter(m=>m.startsWith(year+'-'));
  const publicManifest=json(join(root,'data/'+kind+'/index.json'));
  readers[kind]={manifest:{...publicManifest,schema:2,regional:{bases:{[code]:Object.fromEntries(months.map(m=>[m,true]))}}},table,inputs:{},
   regionMonth(c,month){decoded++;const p=kind==='daily'?`data/daily/0/${month}.bin`:`data/rental/months/${month}-41.bin`,s=p.replace('.bin','-state.bin');
    const rows=m.sources[p]?json(join(scratch,p),m.sources[p]).rows:[],state=m.sources[s]?json(join(scratch,s),m.sources[s]):{opening:[],updates:[]};return scopedNativeMonth(c,{rows,...state});
   }};
 }
 const fingerprint=(c,months)=>hash(JSON.stringify(['daily','rental'].map(k=>[k,months.map(m=>{
  const p=k==='daily'?`data/daily/0/${m}.bin`:`data/rental/months/${m}-41.bin`;return[m,...[p,p.replace('.bin','-state.bin')].map(p=>{const h=native[k].sources[p];if(!h)return[p,null];const b=readFileSync(join(scratch,p));if(hash(b)!==h)throw Error('Native source mismatch');checks.set(join(scratch,p),h);return[p,h];})];
 })])));
 readers.verify=()=>{for(const[p,h]of checks)if(hash(readFileSync(p))!==h)throw Error('Input changed');};
 const base=mkdtempSync(join(tmpdir(),'housing-year-bench-')),cache=join(base,'cache'),old=process.env.NODO_FULL_VERIFY;delete process.env.NODO_FULL_VERIFY;let n=0;
 try{
  const run=reuse=>{if(reuse)readers.periodFingerprint=fingerprint;else delete readers.periodFingerprint;decoded=0;
   const output=join(base,'out'+n++),t=performance.now(),r=buildHousingRegions(root,output,codec,{readers,cacheDir:cache,codes:[code]});
   const seconds=(performance.now()-t)/1000,manifest=JSON.parse(readFileSync(join(output,'data/daily/index.json')));
   return{seconds,decoded,yearsReused:r.metrics[0].yearsReused,files:manifest.sources};
  };
  const seed=run(true),pairs=[];for(let i=0;i<3;i++){const baseline=run(false),candidate=run(true);assert.deepEqual(candidate.files,baseline.files);assert.equal(candidate.decoded,0);pairs.push({baseline,candidate});}
  const median=a=>a.sort((a,b)=>a-b)[1],b=median(pairs.map(p=>p.baseline.seconds)),c=median(pairs.map(p=>p.candidate.seconds));
  const result={status:c<=b*.8?'PASS_SEGMENT_TARGET':'PERFORMANCE_STOPPED',productionChanged:false,fullPrepareMeasured:false,code,year,budgetSeconds:30,
   seedSeconds:seed.seconds,baselineMedianSeconds:b,candidateMedianSeconds:c,reduction:1-c/b,pairs:pairs.map(p=>({baseline:{seconds:p.baseline.seconds,decoded:p.baseline.decoded},candidate:{seconds:p.candidate.seconds,decoded:p.candidate.decoded,yearsReused:p.candidate.yearsReused}})),outputDifferences:0};
  writeFileSync(report,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{if(old===undefined)delete process.env.NODO_FULL_VERIFY;else process.env.NODO_FULL_VERIFY=old;rmSync(base,{recursive:true});}
}
