// Read-only, bounded replay. Public data/DBs/consumer checkpoints are never written.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {realpathSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {regionalReader} from './regional-data.mjs';
import {ValidationSession} from './validation-session.mjs';
import {partitionDependencies} from '../js/housing-partition.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
if(process.argv[2]!=='--worker'){
 const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',...process.argv.slice(2)],{timeout:30000,encoding:'utf8',maxBuffer:1048576});
 if(r.error||r.status!==0){process.stderr.write(r.stderr||'');console.log(JSON.stringify({status:'PERFORMANCE_STOPPED',error:r.error?.message??'Worker failed'}));process.exitCode=1;}else process.stdout.write(r.stdout);
}else{
 const [siteArg,code,mode,cacheArg,reportArg]=process.argv.slice(3),root=realpathSync(siteArg),cache=resolve(cacheArg),report=resolve(reportArg);
 if(!/^\d{5}$/.test(code)||!['baseline','candidate'].includes(mode)||existsSync(report)||[cache,report].some(p=>p.toLowerCase()===root.toLowerCase()||p.toLowerCase().startsWith(root.toLowerCase()+sep)))throw Error('Explicit scope and new external report/cache required');
 const started=performance.now(),d=regionalReader(root,'daily'),r=regionalReader(root,'rental'),months=Object.keys(d.manifest.regional.quarters[code]??{}).sort();
 if(!months.length)throw Error('Unknown scope');
 const session=new ValidationSession(root,{directory:cache,roots:['tools/regional-data.mjs']}),results=[];let rows=0;
 for(const month of months){const dependencies={};for(const reader of[d,r]){const entry=reader.table.regions.get(code).entry;if(reader.manifest.regional.states[code]?.[month]===undefined)throw Error('Missing state');for(const p of[entry.identities,reader.manifest.regional.quarters[code][month],reader.manifest.regional.states[code][month]].filter(Boolean))for(const dep of partitionDependencies(p,reader.manifest.sources)){reader.physical(dep,false);dependencies[dep]=reader.manifest.sources[dep];}}
  const verify=()=>{const values=[d.regionMonth(code,month),r.regionMonth(code,month)];return {status:'PASS',rows:values.reduce((n,v)=>n+Object.values(v).reduce((n,a)=>n+a.length,0),0),sha256:hash(JSON.stringify(values,(_,v)=>typeof v==='bigint'?['bigint',v.toString()]:v))};};
  const result=mode==='candidate'?session.check('region/'+code+'/'+month,dependencies,verify):verify();rows+=result.rows;results.push([month,result]);
 }
 if(mode==='candidate')session.flush();
 const result={status:'PASS_SCOPED_READ_ONLY',mode,code,months:months.length,rows,sha256:hash(JSON.stringify(results)),seconds:(performance.now()-started)/1000,validation:session.stats,publicDeployment:false};writeFileSync(report,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
