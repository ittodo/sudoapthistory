// Real published data; recreate detail source in memory, compare only bounded detail generation.
import{spawnSync}from'node:child_process';import{readFileSync,writeFileSync,mkdtempSync,rmSync,realpathSync}from'node:fs';import{join,resolve}from'node:path';
import{tmpdir}from'node:os';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';import{gzipSync,gunzipSync}from'node:zlib';
import{performance}from'node:perf_hooks';import assert from'node:assert/strict';import{regionalReader}from'./regional-data.mjs';
import{detailMemo,detailIdentity,detailDependencies,detailEngine}from'./housing-detail-cache.mjs';import{packSaleYear}from'./build-housing-sales.mjs';
import{restoreSaleReferences}from'../js/housing-sale-detail.mjs';import{packContractDetails,restoreDetails,contractDisplay}from'../js/housing-contract-detail.mjs';import*as codec from'../js/generated/housing-columns.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),canon=r=>JSON.stringify(Object.fromEntries(Object.keys(r).sort().map(k=>[k,r[k]])));
if(process.argv[2]!=='--worker'){
 const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',...process.argv.slice(2)],{timeout:30000,encoding:'utf8',maxBuffer:1048576});
 if(child.error||child.status!==0){console.error(child.stderr);console.log(JSON.stringify({status:'SEGMENT_STOPPED',budgetSeconds:30,error:child.error?.message||'Diagnostic failed'}));process.exitCode=1;}else process.stdout.write(child.stdout);
}else{
 const[kind,rootArg,code,period,reportArg]=process.argv.slice(3),root=realpathSync(rootArg),report=resolve(reportArg);
 if(!['sale','rental'].includes(kind)||!/^\d{5}$/.test(code)||report.startsWith(root))throw Error('External report and valid scope required');
 const inputs=new Map(),read=(p,expected)=>{const bytes=readFileSync(join(root,p));if(expected&&hash(bytes)!==expected)throw Error('Published source mismatch');inputs.set(p,hash(bytes));return bytes;};
 const reader=regionalReader(root,kind==='sale'?'daily':'rental',{verifyOnce:true});let key,identity,make,rows;
 if(kind==='sale'){
  const manifest=JSON.parse(read('data/sale-details/index.json')),path=manifest.regions[code][period],wire=read(path,manifest.sources[path]),months=reader.manifest.months.filter(m=>m.startsWith(period));
  const facts=months.flatMap(m=>reader.regionMonth(code,m,false).rows),groups=[...restoreSaleReferences(gunzipSync(wire),facts,reader.table,codec,code)].map(([key,values])=>{const[ci,area]=key.split('|');return{complex:code+':'+ci,area:Number(area),ts:values.map(t=>[Math.floor(t.date/100)%100,t.date%100,t.price,t.floor,t.flags,t.cancelled])};});
  rows=groups.reduce((n,g)=>n+g.ts.length,0);identity=detailIdentity(reader.table,[code]);key=[detailEngine('build-housing-sales.mjs'),kind,code,period,groups,detailDependencies(reader,code,months)];
  make=()=>{const current=months.flatMap(m=>reader.regionMonth(code,m,false).rows),v=packSaleYear(groups,current,reader.table,code,period);
   assert.deepEqual(v.bytes,wire);return{result:{rows:v.rows},files:new Map([[path,v.bytes]])};};
 }else{
  const manifest=JSON.parse(read('data/contracts/index.json')),part=manifest.partitions.find(p=>p.service==='apartment-rent'&&p.lawd===code&&p.month===period);if(!part)throw Error('Published contract scope missing');
  const month=period.slice(0,4)+'-'+period.slice(4),codes=part.regionCodes,facts=codes.flatMap(c=>reader.regionMonth(c,month,false).rows);
  const details=part.details?gunzipSync(read(part.details,manifest.sources[part.details])):codec.encodeColumns(codec.schemas.ContractDetail,[]);
  const unmatched=part.unmatched?gunzipSync(read(part.unmatched,manifest.sources[part.unmatched])):codec.encodeColumns(codec.schemas.ContractUnmatched,[]);
  const dictionary=part.display?JSON.parse(read(part.display,manifest.sources[part.display])):{dictionary:[],refs:{}},display=contractDisplay(details,dictionary,codec);
  const raw=restoreDetails(details,unmatched,display,facts,reader.table,codec);rows=raw.length;identity=detailIdentity(reader.table,codes);
  key=[detailEngine('build-housing-details.mjs'),kind,part,hash(JSON.stringify(raw)),Object.assign({},...codes.map(c=>detailDependencies(reader,c,[month])))];
  make=()=>{const current=codes.flatMap(c=>reader.regionMonth(c,month,false).rows),v=packContractDetails(raw,current,reader.table,codec);
   assert.deepEqual(restoreDetails(v.details,v.unmatched,v.display,current,reader.table,codec).map(canon).sort(),raw.map(canon).sort());
   const files=new Map();if(part.details){const b=gzipSync(v.details,{level:6});assert.deepEqual(b,read(part.details,manifest.sources[part.details]));files.set(part.details,b);}
   if(part.unmatched){const b=gzipSync(v.unmatched,{level:6});assert.deepEqual(b,read(part.unmatched,manifest.sources[part.unmatched]));files.set(part.unmatched,b);}
   return{result:{rows,display:v.display},files};
  };
 }
 const base=mkdtempSync(join(tmpdir(),'detail-bench-')),old=process.env.NODO_FULL_VERIFY;delete process.env.NODO_FULL_VERIFY;
 try{
  const run=cache=>{const t=performance.now(),v=detailMemo(cache,key,identity,()=>true,make);return{seconds:(performance.now()-t)/1000,reused:v.reused,files:Object.fromEntries([...v.files].map(([p,b])=>[p,hash(b)])),result:v.result};};
  const seed=run(base),pairs=[];for(let i=0;i<3;i++){const b=run(null),c=run(base);assert.deepEqual(c.files,b.files);assert.deepEqual(c.result,b.result);pairs.push({baseline:{seconds:b.seconds,reused:b.reused},candidate:{seconds:c.seconds,reused:c.reused}});}
  reader.recheck();for(const[p,h]of inputs)assert.equal(hash(readFileSync(join(root,p))),h);
  const median=a=>a.sort((a,b)=>a-b)[1],b=median(pairs.map(p=>p.baseline.seconds)),c=median(pairs.map(p=>p.candidate.seconds)),result={status:c<=b*.8?'PASS_SEGMENT_TARGET':'PERFORMANCE_STOPPED',kind,code,period,rows,productionChanged:false,fullDetailBuildMeasured:false,budgetSeconds:30,seedSeconds:seed.seconds,baselineMedianSeconds:b,candidateMedianSeconds:c,reduction:1-c/b,outputDifferences:0,pairs};
  writeFileSync(report,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{if(old===undefined)delete process.env.NODO_FULL_VERIFY;else process.env.NODO_FULL_VERIFY=old;rmSync(base,{recursive:true});}
}
