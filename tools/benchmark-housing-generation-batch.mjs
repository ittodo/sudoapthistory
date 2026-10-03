// Saved native input only; bounded segment replay, never collection/apply/publication.
import{spawnSync}from'node:child_process';import{readFileSync,writeFileSync,mkdtempSync,rmSync,realpathSync,mkdirSync}from'node:fs';
import{join,resolve}from'node:path';import{tmpdir}from'node:os';import{fileURLToPath}from'node:url';import{gunzipSync}from'node:zlib';import{createHash}from'node:crypto';import{performance}from'node:perf_hooks';import assert from'node:assert/strict';
import{GenerationFileSession}from'./housing-generation-batch.mjs';import{buildHousingRegions}from'./build-housing-regions.mjs';import{scopedNativeMonth}from'./housing-native-adapter.mjs';import*as codec from'../js/generated/housing-columns.mjs';import'../js/regional-data.js';
import{validationEngine}from'./validation-session.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
if(process.argv[2]!=='--worker'){
 const c=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',...process.argv.slice(2)],{timeout:30000,encoding:'utf8',maxBuffer:1048576});
 if(c.error||c.status!==0){console.error(c.stderr);console.log(JSON.stringify({status:'SEGMENT_STOPPED',budgetSeconds:30,error:c.error?.message||'Replay failed'}));process.exitCode=1;}else process.stdout.write(c.stdout);
}else{
 const[siteArg,scratchArg,code,year,reportArg]=process.argv.slice(3),site=realpathSync(siteArg),scratch=realpathSync(scratchArg),report=resolve(reportArg);
 if(!/^\d{5}$/.test(code)||!/^\d{4}$/.test(year)||!scratch.includes('regional-transaction-cache')||report.toLowerCase().startsWith(site.toLowerCase())||report.toLowerCase().startsWith(scratch.toLowerCase()))throw Error('Isolated segment input/report required');
 const initial=new Map(),checked=new Map(),json=(p,h)=>{const b=readFileSync(p);if(h&&hash(b)!==h)throw Error('Native input digest');checked.set(p,hash(b));return JSON.parse(p.endsWith('.bin')?gunzipSync(b):b);};
 const descriptor=json(join(site,'data/daily/regions/index.json')),entry=descriptor.regions[code],payloads={};for(const p of [entry.identities,entry.metadata])payloads[p]=json(join(site,p));
 const table=globalThis.NodoRegional.tables({...descriptor,regions:{[code]:entry}},payloads,'daily'),native={},readers={};
 let version=0,decodes=0,session=null;
 for(const kind of ['daily','rental']){
  const m=json(join(scratch,'data/'+kind+'/index.json'));native[kind]=m;const months=m.months.filter(m=>m.startsWith(year+'-')||m.startsWith(String(Number(year)-1)+'-')),published=json(join(site,'data/'+kind+'/index.json'));
  readers[kind]={manifest:{...published,schema:2,regional:{bases:{[code]:Object.fromEntries(months.map(m=>[m,true]))}}},table,inputs:{},regionMonth(c,month){
   decodes++;const province=code.startsWith('41')?0:code.startsWith('11')?1:2,p=kind==='daily'?'data/daily/'+province+'/'+month+'.bin':'data/rental/months/'+month+'-'+code.slice(0,2)+'.bin',state=p.replace('.bin','-state.bin'),rows=m.sources[p]?structuredClone(json(join(scratch,p),m.sources[p]).rows):[],s=m.sources[state]?json(join(scratch,state),m.sources[state]):{opening:[],updates:[]};
   if(version&&kind==='daily'&&month===year+'-09'){if(!rows.length)throw Error('Missing correction input');rows[0][2]+=version;rows[0][10]=hash(JSON.stringify(rows[0])).slice(0,24);}return scopedNativeMonth(c,{rows,...s});
  }};
 }
 for(const[p,h]of checked)initial.set(p,h);
 const fingerprint=(c,months)=>hash(JSON.stringify(['daily','rental'].map(k=>[k,months.map(m=>{
  const province=code.startsWith('41')?0:code.startsWith('11')?1:2,p=k==='daily'?'data/daily/'+province+'/'+m+'.bin':'data/rental/months/'+m+'-'+code.slice(0,2)+'.bin';
  return [m,m===year+'-09'?version:0,...[p,p.replace('.bin','-state.bin')].map(p=>{const h=native[k].sources[p];if(h&&!session?.old&&!checked.has(join(scratch,p))){const b=readFileSync(join(scratch,p));if(hash(b)!==h)throw Error('Native digest');checked.set(join(scratch,p),h);}return[p,h||null];})];
 })])));
 readers.stateFingerprint=(c,months)=>hash(JSON.stringify(['daily','rental'].map(k=>[k,months.map(month=>{const province=code.startsWith('41')?0:code.startsWith('11')?1:2,p=k==='daily'?'data/daily/'+province+'/'+month+'-state.bin':'data/rental/months/'+month+'-'+code.slice(0,2)+'-state.bin';return[month,p,native[k].sources[p]||null];})])));
 readers.regionOpening=(kind,c,month)=>{const province=code.startsWith('41')?0:code.startsWith('11')?1:2,p=kind==='daily'?'data/daily/'+province+'/'+month+'-state.bin':'data/rental/months/'+month+'-'+code.slice(0,2)+'-state.bin';return native[kind].sources[p]?scopedNativeMonth(c,{rows:[],...json(join(scratch,p),native[kind].sources[p])}).opening:[];};
 readers.periodFingerprint=fingerprint;const allMonths=[...new Set(['daily','rental'].flatMap(k=>readers[k].manifest.regional.bases[code]?Object.keys(readers[k].manifest.regional.bases[code]):[]))].sort();
 readers.regionFingerprint=c=>fingerprint(c,allMonths);readers.verify=()=>{for(const[p,h]of checked)if(hash(readFileSync(p))!==h)throw Error('Native input changed');};
 const engineStarted=performance.now(),preparedEngine=validationEngine(site,{roots:['tools/build-housing-from-native.mjs']}),enginePreparationSeconds=(performance.now()-engineStarted)/1000;
 const base=mkdtempSync(join(tmpdir(),'generation-batch-segment-')),cache=join(base,'candidate-cache'),baselineCache=join(base,'baseline-cache');let n=0;const old=process.env.NODO_FULL_VERIFY;delete process.env.NODO_FULL_VERIFY;
 try{
  const run=(candidate,accept=false)=>{
   checked.clear();decodes=0;const output=join(base,'out'+n++),batch={schema:1,revision:version?'after'+version:'before',seq:version?1:0,batches:[]};
   if(version){const payload=JSON.stringify({schema:1,complete:true,previousRevision:'before',revision:'after'+version,tradePartitions:[{table:'transactions',changedPartitions:[[code,Number(year),9]]}]});batch.batches=[{seq:1,payload,digest:hash(payload)}];}
   const started=performance.now();session=candidate?new GenerationFileSession({site,output,cache,batch,engine:preparedEngine}):null;
   const prepared=performance.now(),result=buildHousingRegions(site,output,codec,{readers,cacheDir:candidate?cache:baselineCache,codes:[code],generationSession:session}),built=performance.now(),consumption=session?.finish(),finished=performance.now();
   if(accept)writeFileSync(join(cache,'generation-consumer.json'),readFileSync(consumption.pending));
   const seconds=(performance.now()-started)/1000,manifests=Object.fromEntries(['daily','rental'].map(k=>[k,hash(readFileSync(join(output,'data/'+k+'/index.json')))])),files=JSON.parse(readFileSync(join(output,'data/daily/index.json'))).sources;
   return{seconds,phases:{setup:(prepared-started)/1000,packing:(built-prepared)/1000,receipt:(finished-built)/1000},decodes,nativeFilesRead:checked.size,files,manifests,metrics:result.metrics[0],consumption};
  };
  const existingSeed=run(false),candidateSeed=run(true,true),cases={};
  for(const name of ['unchanged','past-correction']){
   version=name==='unchanged'?0:1;const pairs=[];
   for(let i=0;i<3;i++){if(name==='past-correction')version=i+1;const baseline=run(false),candidate=run(true);assert.deepEqual(candidate.files,baseline.files);assert.deepEqual(candidate.manifests,baseline.manifests);pairs.push({baseline,candidate});}
   const median=a=>a.toSorted((a,b)=>a-b)[1],b=median(pairs.map(p=>p.baseline.seconds)),c=median(pairs.map(p=>p.candidate.seconds));
   cases[name]={status:c<=b*.8?'PASS_SEGMENT_TARGET':'PERFORMANCE_STOPPED',baselineMedianSeconds:b,candidateMedianSeconds:c,reduction:1-c/b,outputDifferences:0,exactManifestBytes:true,pairs:pairs.map(p=>({baseline:{seconds:p.baseline.seconds,phases:p.baseline.phases,decodes:p.baseline.decodes,nativeFilesRead:p.baseline.nativeFilesRead},candidate:{seconds:p.candidate.seconds,phases:p.candidate.phases,decodes:p.candidate.decodes,nativeFilesRead:p.candidate.nativeFilesRead,yearsReused:p.candidate.metrics.yearsReused,quartersReused:p.candidate.metrics.quartersReused,scopesReused:p.candidate.consumption.scopesReused}}))};
   if(cases[name].status!=='PASS_SEGMENT_TARGET')break;
  }
  for(const[p,h]of initial)if(hash(readFileSync(p))!==h)throw Error('Frozen input changed');
  const result={independentCaches:true,changedTrials:'three distinct price corrections from the same accepted baseline',status:Object.values(cases).every(c=>c.status==='PASS_SEGMENT_TARGET')?'PASS_SEGMENT_TARGET':'PERFORMANCE_STOPPED',budgetSeconds:30,operatingChanged:false,fullPrepareMeasured:false,code,year,enginePreparationSeconds,engineProof:'same verified seed fingerprint supplied by official prepare; fixture preparation measured separately',existingSeedSeconds:existingSeed.seconds,candidateSeedSeconds:candidateSeed.seconds,cases};
  mkdirSync(join(report,'..'),{recursive:true});writeFileSync(report,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{if(old===undefined)delete process.env.NODO_FULL_VERIFY;else process.env.NODO_FULL_VERIFY=old;rmSync(base,{recursive:true});}
}
