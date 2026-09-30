import{writeFileSync}from'node:fs';
import{gzipSync}from'node:zlib';
import{pathToFileURL}from'node:url';
import assert from'node:assert/strict';
import{regionalReader}from'./regional-data.mjs';
import{packStateTimeline,openStateTimeline,encodeStateFile,decodeStateFile}from'./housing-state-timeline.mjs';
const[root,codecPath,output,scope='sample']=process.argv.slice(2);if(!root||!codecPath||!output)throw Error('SITE CODEC OUTPUT required');
const codec=await import(pathToFileURL(codecPath)),results=[],inputHashes={};
for(const kind of ['daily','rental']){
 const reader=regionalReader(root,kind);
 for(const lawd of scope==='all'?[...reader.table.regions.keys()].sort():['11110','11680','41135','28185']){
  const months=reader.manifest.months.filter(m=>m>='2025-10'&&m<='2026-09'),input={};
  for(const month of months)input[month]=reader.regionMonth(lawd,month).opening;
  const start=performance.now(),packed=packStateTimeline(lawd,kind,input,codec),opened=openStateTimeline(packed,codec);
  for(const month of months)assert.deepEqual(opened.month(month),input[month]);
  const old=gzipSync(JSON.stringify(input),{level:6}).length;
  const wire=encodeStateFile(packed);const wireReader=decodeStateFile(wire,codec,{lawd,kind});for(const month of months)assert.deepEqual(wireReader.month(month),input[month]);
  const bytes=gzipSync(wire,{level:6}).length;
  process.stderr.write(kind+' '+lawd+' state roundtrip PASS\n');
  results.push({lawd,kind,months:months.length,...packed.stats,oldSingleGzipBytes:old,newSingleGzipBytes:bytes,reduction:100*(1-bytes/old),exactRoundtrip:'PASS',seconds:(performance.now()-start)/1000});
 }
 Object.assign(inputHashes,reader.inputs);
}
const report={status:'STATE_TIMELINE_PREVIEW',publicDeployment:false,scope:scope+' regions, 12 monthly opening states only; both alternatives gzip level 6 as one payload',excluded:['transactions','updates','metadata','contract extras','full public packaging'],inputHashes,results};writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({regions:results.length/2,oldBytes:results.reduce((n,r)=>n+r.oldSingleGzipBytes,0),newBytes:results.reduce((n,r)=>n+r.newSingleGzipBytes,0),report:output}));
