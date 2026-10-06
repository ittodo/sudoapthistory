// Two real month/province reads, isolated cache objects, unchanged public sources.
import {spawnSync} from 'node:child_process';
import {writeFileSync,existsSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {regionalReader} from './regional-data.mjs';
import {createHousingDecodeCache} from './housing-regional-reader.mjs';
if(process.argv[2]!=='--worker'){
 const p=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',...process.argv.slice(2)],{timeout:30000,encoding:'utf8',maxBuffer:1048576});
 if(p.error||p.status!==0){console.error(p.stderr);console.log(JSON.stringify({status:'SEGMENT_STOPPED',budgetSeconds:30,error:p.error?.message||'Probe failed'}));process.exitCode=1;}else process.stdout.write(p.stdout);
}else{
 const[rootArg,province,monthsArg,mode,reportArg]=process.argv.slice(3),root=realpathSync(rootArg),months=monthsArg.split(','),report=resolve(reportArg);
 if(!['0','1','2','all'].includes(province)||!['baseline','candidate','baseline-rental','candidate-rental'].includes(mode)||months.some(m=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))||existsSync(report)||report.toLowerCase().startsWith(root.toLowerCase()))throw Error('Explicit read-only scope, mode and new external report required');
 const cache=createHousingDecodeCache(mode.startsWith('baseline')?{maxEntries:4}:{maxBytes:1024*1024*1024}),kind=mode.endsWith('-rental')?'rental':'daily',reader=regionalReader(root,kind,{verifyOnce:true,decodeCache:cache}),phases=[];
 for(const month of months)for(const code of province==='all'?['0','1','2']:[province]){const before={...cache.stats},started=performance.now(),shard=kind==='daily'?reader.readMapState(`data/daily/${code}/${month}-state.bin`):reader.read(`data/rental/months/${month}-${['41','11','28'][Number(code)]}-state.bin`);phases.push({month,province:code,seconds:(performance.now()-started)/1000,openingRows:shard.opening.length,updateRows:shard.updates.length,factRows:shard.rows.length,fullSha256:createHash('sha256').update(JSON.stringify(shard,(_,v)=>typeof v==='bigint'?['bigint',v.toString()]:v)).digest('hex'),sha256:createHash('sha256').update(JSON.stringify(kind==='rental'?{opening:shard.opening,updates:shard.updates}:shard,(_,v)=>typeof v==='bigint'?['bigint',v.toString()]:v)).digest('hex'),hits:cache.stats.hits-before.hits,misses:cache.stats.misses-before.misses});}
 const beforeFinal=performance.now();reader.recheck();const result={status:'TEST_REPLAY_NON_PUBLISHABLE',mode,kind,projectionOnly:false,province,phases,finalVerificationSeconds:(performance.now()-beforeFinal)/1000,decodeCache:cache.stats,rssBytes:process.memoryUsage().rss,maxRssBytes:process.resourceUsage().maxRSS*1024,productionChanged:false,fullCiMeasured:false,budgetSeconds:30};
 writeFileSync(report,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
