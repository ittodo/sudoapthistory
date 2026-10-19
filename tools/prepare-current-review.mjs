// Complete an isolated review preview. This does not publish or update the baseline.
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,cpSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {refreshMetadata} from './refresh-current-review-metadata.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function prepareCurrentReview({baseline,candidate,pipeline,adminSource,runtime,runtimeSha256}){
  baseline=realpathSync(baseline);candidate=realpathSync(candidate);
  if(!candidate.split(/[\\/]/).includes('_ops'))throw Error('An isolated _ops candidate is required');
  for(const [a,b]of [[baseline,candidate],[candidate,baseline]]){const r=relative(a,b);if(!r||(!r.startsWith('..')&&!isAbsolute(r)))throw Error('Candidate and baseline must be separate');}
  const mapPath=join(candidate,'data/map/index.json'),map=JSON.parse(readFileSync(mapPath));
  if(map.meta?.candidateOnly!==true)throw Error('Explicit local candidate required');
  if(existsSync(join(candidate,'data/apartments/index.json')))throw Error('Candidate already prepared');
  const stage=join(candidate,'admin-stage');
  const result=spawnSync(pipeline,['map-admin'],{input:JSON.stringify({directory:stage,source:adminSource,runtime,runtime_sha256:runtimeSha256,complexes:map.d}),encoding:'utf8',maxBuffer:4*1024*1024,windowsHide:true});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('Native administrative membership failed: '+result.stderr.slice(-1000));
  const admin=JSON.parse(readFileSync(join(stage,'admin.json')));
  const exported=JSON.parse(readFileSync(join(candidate,'manifest.json')));
  const parcelSources=Object.fromEntries(Object.entries(exported.outputs).filter(([name])=>/^data\/map\/parcels\/[^/]+\.json$/.test(name)).map(([name,proof])=>[name,proof.sha256]));
  map.d=admin.d;map.admin=admin.admin;map.meta.sources={...parcelSources,...admin.meta.sources};
  for(const name of Object.keys(admin.meta.sources)){
    if(!/^data\/map\/regions\/[\w.-]+\.json$/.test(name))throw Error('Unexpected administrative output path');
    const from=join(stage,name),to=join(candidate,name);
    if(hash(readFileSync(from))!==admin.meta.sources[name])throw Error('Administrative output changed');
    mkdirSync(resolve(to,'..'),{recursive:true});cpSync(from,to,{force:false,errorOnExist:true});
  }
  writeFileSync(mapPath,JSON.stringify(map));
  const boundaryResult=spawnSync(pipeline,['map-boundaries'],{input:JSON.stringify({site:candidate,runtime,runtime_sha256:runtimeSha256}),encoding:'utf8',maxBuffer:4*1024*1024,windowsHide:true});
  if(boundaryResult.error)throw boundaryResult.error;
  if(boundaryResult.status!==0)throw Error('Native complex boundary build failed: '+boundaryResult.stderr.slice(-1000));
  const boundaries=JSON.parse(boundaryResult.stdout);
  const metadata=refreshMetadata(baseline,candidate);
  const proof={schema:1,candidateOnly:true,status:'PREVIEW_READY',createdAt:new Date().toISOString(),baseline,candidate,
    mapComplexes:map.d.length,adminRegions:admin.admin.regions.length,boundaries,metadata,productionUpdated:false};
  writeFileSync(join(candidate,'preview-preparation.json'),JSON.stringify(proof,null,2));return {...proof,metadata:{...metadata,outputs:undefined}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3)throw Error('Usage: node prepare-current-review.mjs REQUEST_JSON');
  console.log(JSON.stringify(prepareCurrentReview(JSON.parse(readFileSync(process.argv[2],'utf8')))));
}
