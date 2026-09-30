import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {regionalReader} from './regional-data.mjs';
import {factVectors,packFacts,unpackFacts} from './housing-facts.mjs';
const [root,codecPath,output]=process.argv.slice(2);if(!root||!codecPath||!output)throw Error('Usage: SITE CODEC OUTPUT');
const codec=await import(pathToFileURL(codecPath));const results=[];const daily=regionalReader(root,'daily'),rental=regionalReader(root,'rental');
const canonical=v=>Object.fromEntries(Object.entries(v).map(([k,rows])=>[k,rows.map(r=>JSON.stringify(r)).sort()]));
for(const lawd of ['11110','11680','41135','28185']){
 const months=Object.fromEntries(['2026-07','2026-08','2026-09'].map(month=>[month,{daily:daily.regionMonth(lawd,month),rental:rental.regionMonth(lawd,month)}])),identity=daily.table.regions.get(lawd).identity;
 const before=factVectors(months),start=performance.now(),packed=packFacts(lawd,months,identity,codec),roundtrip=unpackFacts(lawd,2026,packed,codec);assert.deepEqual(canonical(roundtrip),canonical(before));
 const plain=Buffer.from(JSON.stringify(before)),binary=Buffer.concat([packed.groups,packed.sale,packed.rental]),a=gzipSync(plain,{level:6}),b=gzipSync(binary,{level:6});results.push({lawd,sale:before.sale.length,rental:before.rental.length,addedExactAreas:packed.addedAreas,factsJsonBytes:plain.length,factsJsonGzipBytes:a.length,factsPackedBytes:binary.length,factsPackedGzipBytes:b.length,savingsPercent:100*(1-b.length/a.length),roundTrip:'PASS',seconds:(performance.now()-start)/1000});
}
const report={status:'FACTS_ONLY_BENCHMARK',publicDeployment:false,inputMode:'hash-verified materialized baseline plus current corrections',inputHashes:{...daily.inputs,...rental.inputs},excluded:['comparison tables','map states','metadata','contract extras','full site assets'],results};writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,results,report:output}));
