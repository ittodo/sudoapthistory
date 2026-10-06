// Read-only replay of a private generation checkpoint; never accepts or publishes it.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync,statSync,realpathSync,existsSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {compactGenerationScopes} from './housing-generation-batch.mjs';
if(process.argv[2]!=='--worker'){
 const p=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),'--worker',...process.argv.slice(2)],{timeout:30000,encoding:'utf8',maxBuffer:1048576});
 if(p.error||p.status!==0){console.error(p.stderr);console.log(JSON.stringify({status:'SEGMENT_STOPPED',budgetSeconds:30,error:p.error?.message||'Probe failed'}));process.exitCode=1;}else process.stdout.write(p.stdout);
}else{
const [inputArg,reportArg]=process.argv.slice(3);
if(!inputArg||!reportArg)throw Error('Usage: node --expose-gc benchmark-generation-checkpoint.mjs INPUT REPORT');
const input=realpathSync(inputArg),report=resolve(reportArg),parent=realpathSync(dirname(report));
if(existsSync(report)||report===input||parent===dirname(input)||!parent.toLowerCase().includes(`${sep}_ops${sep}reports${sep}`))throw Error('Benchmark output must be a separate _ops/reports folder');
const sha=v=>createHash('sha256').update(v).digest('hex'),timings={};
const phase=(name,fn)=>{const start=performance.now(),value=fn();timings[name]=(performance.now()-start)/1000;if(timings[name]>30)throw Error(`STOP: ${name} exceeds 30 seconds`);return value;};
const before=statSync(input),result={status:'TEST_REPLAY_NON_PUBLISHABLE',input,timings,consumerAcknowledged:false,dbApplied:false};
try{
 let raw=phase('read',()=>readFileSync(input));const inputSha=sha(raw);
 const old=phase('legacyParse',()=>JSON.parse(raw));raw=null;
 if(old.body.identityStorage!==undefined)throw Error('This comparison requires a legacy inline-identity checkpoint');
 let serialized=phase('legacySerialize',()=>JSON.stringify(old.body));
 phase('legacyDigest',()=>{if(sha(serialized)!==old.sha256)throw Error('Checkpoint digest mismatch');});
 const legacyBodyBytes=Buffer.byteLength(serialized);serialized=null;global.gc?.();
 const compact=phase('deduplicate',()=>compactGenerationScopes(old.body.scopes));
 const {scopes,...metadata}=old.body;
 const next={...metadata,identityStorage:compact.identityStorage,identities:compact.identities,scopes:compact.scopes};
 serialized=phase('dictionarySerialize',()=>JSON.stringify(next));const compactBodyBytes=Buffer.byteLength(serialized);
 const compactSha=phase('dictionaryDigest',()=>sha(serialized));
 global.gc?.();const reread=phase('dictionaryParse',()=>JSON.parse(serialized));serialized=null;global.gc?.();
 phase('allScopesEquivalent',()=>{const keys=Object.keys(scopes);if(keys.length!==Object.keys(reread.scopes).length)throw Error('Scope inventory differs');for(const key of keys){const {identityRef,...rest}=reread.scopes[key],expanded=Object.fromEntries(Object.keys(scopes[key]).map(k=>[k,k==='identity'?reread.identities[identityRef]:rest[k]]));if(sha(JSON.stringify(scopes[key]))!==sha(JSON.stringify(expanded)))throw Error(`Scope differs: ${key}`);}});
 const after=statSync(input);const afterSha=phase('originalUnchanged',()=>sha(readFileSync(input)));
 if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||inputSha!==afterSha)throw Error('Input changed during replay');
 Object.assign(result,{inputSha256:inputSha,originalReceiptBytes:before.size,legacyBodyBytes,compactBodyBytes,compactBodySha256:compactSha,bytesSaved:legacyBodyBytes-compactBodyBytes,reductionPercent:100*(legacyBodyBytes-compactBodyBytes)/legacyBodyBytes,scopes:Object.keys(scopes).length,metrics:compact.metrics,equivalent:true,originalUnchanged:true});
}catch(error){result.status='FAILED';result.error=error.message;process.exitCode=1;}
writeFileSync(report,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
