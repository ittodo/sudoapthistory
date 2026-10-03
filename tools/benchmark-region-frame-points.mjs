// Read-only public fixture; only final frame packing is timed.
import{spawnSync}from'node:child_process';import{readFileSync,writeFileSync,realpathSync}from'node:fs';import{join,resolve}from'node:path';import{fileURLToPath}from'node:url';import{performance}from'node:perf_hooks';import assert from'node:assert/strict';
import{regionalReader}from'./regional-data.mjs';import{regionModels,rentalFrames,packFrames}from'./build-region-price-cache.mjs';import{rentalGroupFrames}from'./region-price-groups.mjs';
function trialPackFrames(days,snapshot,{stablePoints=false}={}){
  let previous=new Map(),previousPoints=new Map();const updates=[];let opening;
  for(const day of days){const value=snapshot(day),next=new Map(value.regions),changed=[],points=new Map((value.meta.points||[]).map(p=>[p.ci,p])),pointChanges=[];
    delete value.meta.points;
    for(const [id,p]of points)if((!stablePoints||p!==previousPoints.get(id))&&JSON.stringify(p)!==JSON.stringify(previousPoints.get(id)))pointChanges.push([id,p]);
    for(const id of previousPoints.keys())if(!points.has(id))pointChanges.push([id,null]);
    for(const [id,row]of next)if(JSON.stringify(row)!==JSON.stringify(previous.get(id)))changed.push([id,row]);
    for(const id of previous.keys())if(!next.has(id))changed.push([id,null]);
    if(!opening)opening={...value,points:[...points]};else updates.push({day,regions:changed,points:pointChanges,meta:value.meta});previous=next;previousPoints=points;
  }
  return {schema:1,opening,updates};
}
if(process.argv[2]!=='--worker'){
 const p=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',...process.argv.slice(2)],{timeout:30000,encoding:'utf8',maxBuffer:1048576});if(p.error||p.status!==0){console.error(p.stderr);console.log(JSON.stringify({status:'SEGMENT_STOPPED',budgetSeconds:30,error:p.error?.message||'Diagnostic failed'}));process.exitCode=1;}else process.stdout.write(p.stdout);
}else{
 const[rootArg,code,month,reportArg]=process.argv.slice(3),root=realpathSync(rootArg),report=resolve(reportArg);if(!/^\d{5}$/.test(code)||!/^\d{4}-\d{2}$/.test(month)||report.toLowerCase().startsWith(root.toLowerCase()))throw Error('Valid scope/external report required');
 const reader=regionalReader(root,'rental',{verifyOnce:true}),catalog=reader.catalog.complexes,ctx=regionModels(root),region=code.slice(0,2),whole=reader.read('data/rental/months/'+month+'-'+region+'-state.bin'),pick=rows=>rows.filter(r=>catalog[r[0]].id.startsWith(code+'-')),shard={opening:pick(whole.opening),updates:pick(whole.updates)},snapshots=new Map();let dates=[];
 if(!shard.opening.length&&!shard.updates.length)throw Error('No scoped input');
 rentalGroupFrames(ctx,catalog,shard,month,region,'monthly',{engine:'diagnostic',calculate:rentalFrames,pack:(days,snapshot)=>{dates=days;for(const d of days)snapshots.set(d,snapshot(d));return{};}});
 const snapshot=d=>{const v=snapshots.get(d);return{regions:v.regions,meta:{...v.meta,points:v.meta.points}};},run=stable=>{const t=performance.now(),v=stable?trialPackFrames(dates,snapshot,{stablePoints:true}):packFrames(dates,snapshot);return{seconds:(performance.now()-t)/1000,value:v};},pairs=[];
 run(false);run(true);for(let i=0;i<5;i++){const b=run(false),c=run(true);assert.deepEqual(c.value,b.value);pairs.push({baselineSeconds:b.seconds,candidateSeconds:c.seconds});}
 reader.recheck();const median=a=>a.sort((a,b)=>a-b)[2],b=median(pairs.map(p=>p.baselineSeconds)),c=median(pairs.map(p=>p.candidateSeconds)),result={status:c<=b*.8?'PASS_SEGMENT_TARGET':'PERFORMANCE_STOPPED',scope:'final immutable group frame point comparison',code,month,dates:dates.length,openingRows:shard.opening.length,updateRows:shard.updates.length,points:snapshots.get(dates[0]).meta.points.length,baselineMedianSeconds:b,candidateMedianSeconds:c,reduction:1-c/b,outputDifferences:0,fullCiMeasured:false,productionChanged:false,budgetSeconds:30,pairs};writeFileSync(report,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
