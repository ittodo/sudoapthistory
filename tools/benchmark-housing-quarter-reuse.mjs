// Real saved native inputs; isolated outputs. Only one quarter changes per trial.
import {spawnSync} from 'node:child_process';import {readFileSync,writeFileSync,mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';import {performance} from 'node:perf_hooks';import assert from 'node:assert/strict';
import {VerifiedNativeInputs} from './housing-native-inputs.mjs';import {buildHousingRegions} from './build-housing-regions.mjs';
import {scopedNativeMonth} from './housing-native-adapter.mjs';import * as codec from '../js/generated/housing-columns.mjs';import '../js/regional-data.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
if(process.argv[2]!=='--worker') {
 const c=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',...process.argv.slice(2)],{timeout:30000,encoding:'utf8',maxBuffer:1048576});
 if(c.error||c.status!==0){console.error(c.stderr);console.log(JSON.stringify({status:'SEGMENT_STOPPED',budgetSeconds:30,error:c.error?.message||'Benchmark failed'}));process.exitCode=1;}else process.stdout.write(c.stdout);
}else {
 const[rootArg,scratchArg,code,year,reportArg]=process.argv.slice(3),root=realpathSync(rootArg),scratch=realpathSync(scratchArg),report=resolve(reportArg);
 if(!/^\d{5}$/.test(code)||!/^\d{4}$/.test(year)||!scratch.includes('regional-transaction-cache')||report.toLowerCase().startsWith(root.toLowerCase()))throw Error('Read-only native fixture and isolated report required');
 const input=new VerifiedNativeInputs(),json=(p,h)=>input.json(p,h),desc=json(join(root,'data/daily/regions/index.json')),entry=desc.regions[code],payloads={};
 for(const p of [entry.identities,entry.metadata])payloads[p]=json(join(root,p));
 const table=globalThis.NodoRegional.tables({...desc,regions:{[code]:entry}},payloads,'daily'),native={},readers={};let version=0,decoded=0;
 for(const kind of ['daily','rental']){
  const m=json(join(scratch,'data/'+kind+'/index.json'));native[kind]=m;const months=m.months.filter(m=>m.startsWith(year+'-')),publicManifest=json(join(root,'data/'+kind+'/index.json'));
  readers[kind]={manifest:{...publicManifest,schema:2,regional:{bases:{[code]:Object.fromEntries(months.map(m=>[m,true]))}}},table,inputs:{},
   regionMonth(c,month){
    decoded++;const province=code.startsWith('41')?0:code.startsWith('11')?1:2,p=kind==='daily'?'data/daily/'+province+'/'+month+'.bin':'data/rental/months/'+month+'-'+code.slice(0,2)+'.bin',s=p.replace('.bin','-state.bin');
    const rows=m.sources[p]?structuredClone(json(join(scratch,p),m.sources[p]).rows):[],state=m.sources[s]?json(join(scratch,s),m.sources[s]):{opening:[],updates:[]};
    if(version&&kind==='daily'&&month===year+'-09') {
     if(!rows.length)throw Error('Missing correction fixture row');rows[0][2]+=version;rows[0][10]=hash(JSON.stringify(rows[0])).slice(0,24);
    }
    return scopedNativeMonth(c,{rows,...state});
   }};
 }
 const fingerprint=(c,months)=>hash(JSON.stringify(['daily','rental'].map(k=>[k,months.map(m=>{
  const province=code.startsWith('41')?0:code.startsWith('11')?1:2,p=k==='daily'?'data/daily/'+province+'/'+m+'.bin':'data/rental/months/'+m+'-'+code.slice(0,2)+'.bin';
  return [m,m===year+'-09'?version:0,...[p,p.replace('.bin','-state.bin')].map(p=>{const h=native[k].sources[p];if(h)input.check(join(scratch,p),h);return[p,h||null];})];
 })])));
 readers.verify=()=>input.verify();const base=mkdtempSync(join(tmpdir(),'native-quarter-bench-')),cache=join(base,'cache'),prior=process.env.NODO_FULL_VERIFY;delete process.env.NODO_FULL_VERIFY;let n=0;
 try{
  const run=reuse=>{if(reuse)readers.quarterFingerprint=fingerprint;else delete readers.quarterFingerprint;decoded=0;
   const output=join(base,'out'+n++),t=performance.now(),r=buildHousingRegions(root,output,codec,{readers,cacheDir:cache,codes:[code]});
   return {seconds:(performance.now()-t)/1000,decoded,quartersReused:r.metrics[0].quartersReused,files:JSON.parse(readFileSync(join(output,'data/daily/index.json'))).sources,rows:r.metrics[0].rows,bytes:r.metrics[0].bytes};
  };
  const seed=run(true),pairs=[];
  for(version=1;version<=3;version++){const baseline=run(false),candidate=run(true);assert.deepEqual(candidate.files,baseline.files);assert.equal(candidate.quartersReused,3);assert.equal(candidate.decoded,6);pairs.push({baseline,candidate});}
  const median=a=>a.sort((a,b)=>a-b)[1],b=median(pairs.map(p=>p.baseline.seconds)),c=median(pairs.map(p=>p.candidate.seconds));
  const result={status:c<=b*.8?'PASS_SEGMENT_TARGET':'PERFORMANCE_STOPPED',budgetSeconds:30,productionChanged:false,fullPrepareMeasured:false,changedNativeQuarter:'Q3',code,year,rows:seed.rows,bytes:seed.bytes,seedSeconds:seed.seconds,baselineMedianSeconds:b,candidateMedianSeconds:c,reduction:1-c/b,outputDifferences:0,
   pairs:pairs.map(p=>({baseline:{seconds:p.baseline.seconds,decoded:p.baseline.decoded},candidate:{seconds:p.candidate.seconds,decoded:p.candidate.decoded,quartersReused:p.candidate.quartersReused}})),nativeInputReuse:input.metrics};
  writeFileSync(report,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{if(prior===undefined)delete process.env.NODO_FULL_VERIFY;else process.env.NODO_FULL_VERIFY=prior;rmSync(base,{recursive:true});}
}
