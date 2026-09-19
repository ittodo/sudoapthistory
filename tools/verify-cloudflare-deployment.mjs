import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const hash=x=>createHash('sha256').update(x).digest('hex');
const requestSignal=signal=>signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
async function get(url,signal) {const r=await fetch(url,{redirect:'follow',signal:requestSignal(signal),headers:{'Cache-Control':'no-cache'}});if(!r.ok||new URL(r.url).origin!==new URL(url).origin)throw new Error(`Public check failed: ${r.status} ${new URL(url).pathname}`);return Buffer.from(await r.arrayBuffer());}
export async function verify(origin,sha,localManifest,{signal}={}) {
  const url=new URL(origin);if(url.protocol!=='https:' || url.pathname!=='/' || url.search || url.hash)throw new Error('HTTPS origin required');
  if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('Full SHA required');
  const release=JSON.parse(await get(`${url.origin}/deployment.json?v=${sha}`,signal));
  const health=JSON.parse(await get(`${url.origin}/api/health?v=${sha}`,signal));
  if(release.gitSha!==sha||health.gitSha!==sha||health.status!=='ok')throw new Error('Deployment/health SHA mismatch');
  if(health.schemaVersion!==2)throw new Error('Account recovery schema version 2 is required');
  if(typeof health.workerVersionId!=='string'||!health.workerVersionId||health.workerVersionId==='local')throw new Error('Actual Worker version ID missing');
  const raw=await get(`${url.origin}/deployment-manifest.json?v=${sha}`,signal);
  if(hash(raw)!==release.assetManifestSha256)throw new Error('Manifest hash mismatch');
  if(localManifest && hash(readFileSync(localManifest))!==hash(raw))throw new Error('Local build manifest differs');
  const manifest=JSON.parse(raw);if(manifest.gitSha!==sha || !Array.isArray(manifest.files))throw new Error('Invalid manifest');
  // Full manifest is checked against the local build in CI; representative bytes are checked publicly.
  // Large catalogs are covered by the exact manifest and release byte-check cache.
  // Probe JSON routing with one small asset, keeping recurring network checks bounded.
  for(const path of ['data/index.json','data/earnings_index.json'])if(!manifest.files.some(f=>f.path===path))throw new Error(`Required public asset missing: ${path}`);
  const probe=manifest.files.filter(f=>f.path.startsWith('data/')&&f.path.endsWith('.json')&&Number.isSafeInteger(f.bytes)&&f.bytes>0&&f.bytes<=64*1024).sort((a,b)=>a.bytes-b.bytes||a.path.localeCompare(b.path))[0];
  if(!probe)throw new Error('Small JSON probe missing from manifest');
  const samples=['index.html','deployment-version.js',probe.path];
  for(const path of samples) {const f=manifest.files.find(f=>f.path===path);if(!f)throw new Error(`Required public asset missing: ${path}`);if(hash(await get(`${url.origin}/${path}?v=${sha}`,signal))!==f.sha256)throw new Error(`Public hash mismatch: ${path}`);}
  const missing=await fetch(`${url.origin}/data/__migration_missing_${sha}.json`,{redirect:'error',signal:requestSignal(signal)});if(missing.status!==404)throw new Error('Missing JSON must be 404');
  return {...release,workerVersionId:health.workerVersionId,schemaVersion:health.schemaVersion};
}
// A deploy acknowledgement can precede public availability. Retry the entire
// contract, never accept a partial pass or weaken SHA/hash/404 requirements.
export async function verifyWithRetry(origin,sha,localManifest,{
  attempts=7,intervalMs=10000,timeoutMs=180000,check=verify,
  sleep=delay,onRetry=message=>console.error(message)
}={}) {
  const signal=AbortSignal.timeout(timeoutMs);
  for(let attempt=1;attempt<=attempts;attempt++) {
    try {return await check(origin,sha,localManifest,{signal});}
    catch(error) {
      if(attempt===attempts||signal.aborted)throw error;
      onRetry(`Public verification ${attempt}/${attempts} failed: ${error.message}; retrying in ${intervalMs/1000}s`);
      await sleep(intervalMs,undefined,{signal});
    }
  }
  throw new Error('No verification attempts configured');
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {try{console.log(JSON.stringify(await verifyWithRetry(...process.argv.slice(2))));}catch(e){console.error(e.message);process.exitCode=1;}}
