// Bounded raw-input selection benchmark. Public rows restored outside the timed section.
import{spawnSync}from'node:child_process';import{readFileSync,writeFileSync,mkdtempSync,rmSync,realpathSync}from'node:fs';import{join,resolve}from'node:path';import{tmpdir}from'node:os';import{fileURLToPath}from'node:url';import{gunzipSync}from'node:zlib';import{createHash}from'node:crypto';import{performance}from'node:perf_hooks';import assert from'node:assert/strict';
import{regionalReader}from'./regional-data.mjs';import{contractInput}from'./housing-contract-input.mjs';import{detailEngine}from'./housing-detail-cache.mjs';import{restoreDetails,contractDisplay}from'../js/housing-contract-detail.mjs';import*as codec from'../js/generated/housing-columns.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
if(process.argv[2]!=='--worker'){
 const c=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',...process.argv.slice(2)],{timeout:30000,encoding:'utf8',maxBuffer:1048576});
 if(c.error||c.status!==0){console.error(c.stderr);console.log(JSON.stringify({status:'SEGMENT_STOPPED',budgetSeconds:30,error:c.error?.message||'Diagnostic failed'}));process.exitCode=1;}else process.stdout.write(c.stdout);
}else{
 const[rootArg,code,period,reportArg]=process.argv.slice(3),root=realpathSync(rootArg),report=resolve(reportArg);if(!/^\d{5}$/.test(code)||!/^\d{6}$/.test(period)||report.toLowerCase().startsWith(root.toLowerCase()))throw Error('External report and valid scope required');
 const reader=regionalReader(root,'rental',{verifyOnce:true}),inputs=new Map(),read=p=>{const b=readFileSync(join(root,p));inputs.set(p,hash(b));return b;},manifest=JSON.parse(read('data/contracts/index.json')),part=manifest.partitions.find(p=>p.service==='apartment-rent'&&p.lawd===code&&p.month===period);if(!part)throw Error('Missing partition');
 const load=(p,schema)=>{if(!p)return codec.encodeColumns(schema,[]);const b=read(p);assert.equal(hash(b),manifest.sources[p]);return gunzipSync(b);},month=period.slice(0,4)+'-'+period.slice(4),facts=part.regionCodes.flatMap(c=>reader.regionMonth(c,month,false).rows),details=load(part.details,codec.schemas.ContractDetail),unmatched=load(part.unmatched,codec.schemas.ContractUnmatched),dictionary=part.display?JSON.parse(read(part.display)):{dictionary:[],refs:{}};
 if(part.display)assert.equal(inputs.get(part.display),manifest.sources[part.display]);
 const raw=restoreDetails(details,unmatched,contractDisplay(details,dictionary,codec),facts,reader.table,codec),partition={service:'apartment-rent',lawd:code,month:period,path:'apartment-rent/'+code+'/'+period+'.json',count:raw.length},engine=detailEngine('build-housing-details.mjs'),base=mkdtempSync(join(tmpdir(),'contract-read-bench-')),path=join(base,'raw.json'),old=process.env.NODO_FULL_VERIFY;delete process.env.NODO_FULL_VERIFY;writeFileSync(path,JSON.stringify({rows:raw}));
 try{
  const run=cached=>{const t=performance.now(),bytes=readFileSync(path);let value;
   if(cached){const v=contractInput(base,engine,partition,bytes);value={digest:v.digest,count:partition.count,entities:v.entities,bytes:v.bytes,parsed:v.parsed};}
   else{const digest=hash(bytes),rows=JSON.parse(bytes).rows;assert.equal(rows.length,partition.count);value={digest,count:rows.length,entities:[...new Set(rows.map(r=>r.entityId))].sort(),bytes:readFileSync(path).length,parsed:true};}
   assert.equal(hash(readFileSync(path)),value.digest);return{seconds:(performance.now()-t)/1000,...value};};
  const seed=run(true),pairs=[];for(let i=0;i<5;i++){const b=run(false),c=run(true);assert.deepEqual({...c,seconds:0,parsed:true},{...b,seconds:0});assert.equal(c.parsed,false);pairs.push({baselineSeconds:b.seconds,candidateSeconds:c.seconds});}
  reader.recheck();for(const[p,h]of inputs)assert.equal(hash(readFileSync(join(root,p))),h);
  const median=a=>a.sort((a,b)=>a-b)[2],b=median(pairs.map(p=>p.baselineSeconds)),c=median(pairs.map(p=>p.candidateSeconds)),result={status:c<=b*.8?'PASS_SEGMENT_TARGET':'PERFORMANCE_STOPPED',code,period,rows:raw.length,rawBytes:seed.bytes,seedSeconds:seed.seconds,baselineMedianSeconds:b,candidateMedianSeconds:c,reduction:1-c/b,inventoryDifferences:0,rawReconstructed:true,publicInputRestorationMeasured:false,fullBuilderMeasured:false,productionChanged:false,budgetSeconds:30,pairs};writeFileSync(report,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{if(old===undefined)delete process.env.NODO_FULL_VERIFY;else process.env.NODO_FULL_VERIFY=old;rmSync(base,{recursive:true});}
}
