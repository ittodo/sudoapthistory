// Repeatable isolated cache benchmark. Public source files are read only.
import {regionPriceAssets} from './build-region-price-cache.mjs';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?null:args[i+1];};
const root=resolve(value('--root')||process.cwd()),report=value('--report');
if(!report||existsSync(report))throw Error('A new --report path is required');
const stats={},start=performance.now(),assets=regionPriceAssets(root,{stats,reference:args.includes('--reference'),months:value('--months')?.split(',')});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const output={seconds:(performance.now()-start)/1000,stats,assets:assets.map(a=>({path:a.path,sha256:a.sha256||digest(a.bytes),source:a.source,size:a.size||a.bytes.length}))};
const reference=value('--compare');
if(reference){const old=JSON.parse(readFileSync(reference)),expected=new Map(old.assets.map(a=>[a.path,a.sha256]));output.differences=output.assets.filter(a=>a.path.endsWith('.bin')&&expected.get(a.path)!==a.sha256).map(a=>a.path);output.missing=old.assets.filter(a=>!output.assets.some(b=>b.path===a.path)).map(a=>a.path);output.status=output.differences.length||output.missing.length?'FAIL':'PASS';}
writeFileSync(report,JSON.stringify(output,null,2));console.log(JSON.stringify({...output,assets:output.assets.length}));
if(output.status==='FAIL')process.exitCode=1;
