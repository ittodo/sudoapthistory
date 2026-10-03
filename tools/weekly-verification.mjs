// Private CI completion evidence. Normal input/output checks still run on every build.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync,unlinkSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validationEngine} from './validation-session.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const directory='cloudflare/dist/weekly-verification-v1',receiptName='completed.json',selectionName='selection.json';
const roots=['tools/build-region-price-cache.mjs','js/map-model.js','js/daily-model.js','js/rental-model.js','js/rental-map-model.js',
 'tools/housing-map-quarter.mjs','tools/housing-regional-reader.mjs','js/housing-quarter.mjs','js/housing-facts.mjs',
 'js/housing-state-timeline.mjs','js/housing-validation.mjs','js/housing-partition.mjs','js/generated/housing-columns.mjs'];
export function weeklyEngine(root){
 return hash(JSON.stringify({schema:1,validation:validationEngine(root),prices:validationEngine(root,{roots}),
  policy:hash(readFileSync(fileURLToPath(import.meta.url)))}));
}
// Import an already completed full check only from the official Actions API.
// The archive digest, same-SHA public proof and every current semantic engine
// blob must match. A caller-supplied PASS JSON is never an import authority.
export function semanticBlobs(root){
 const result=new Map(),base=resolve(root),visited=new Set();
 function visit(name){if(visited.has(name))return;visited.add(name);const path=resolve(base,name);
  if(!path.startsWith(base+'/')&&!path.startsWith(base+'\\'))throw Error('Unsafe semantic dependency');
  if(lstatSync(path).isSymbolicLink())throw Error('Semantic dependency symlink');const bytes=readFileSync(path),source=bytes.toString();
  result.set(name.replaceAll('\\','/'),createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex'));
  if(/\b(?:import|require)\s*\(\s*[^'"\s]/.test(source))throw Error('Unknown dynamic semantic dependency');
  for(const match of source.matchAll(/['"](\.{1,2}\/[^'"\n]+\.(?:m?js|cjs|json))['"]/g)){
   const next=resolve(dirname(path),match[1]);visit(next.slice(base.length+1).replaceAll('\\','/'));
  }
 }
 const validationRoots=['tools/validation-session.mjs','tools/data-validation-proof.mjs','tools/verify-housing-regions.mjs','tools/verify-housing-sales.mjs','tools/verify-housing-details.mjs','tools/verify-apartment-sale.mjs','tools/verify-apartment-rent.mjs','tools/verify-daily-data.mjs','tools/verify-rental-data.mjs'];
 for(const name of [...roots,...validationRoots])visit(name);return Object.fromEntries(result);
}
export function importable({run,artifact,tree,build,verified,manifest,archiveDigest,blobs,week}){
 if(run.name!=='Cloudflare Production'||run.event!=='push'||run.head_branch!=='main'||run.status!=='completed'||run.conclusion!=='success'||
  !/^[a-f0-9]{40}$/.test(run.head_sha)||weekOf(koreaDate(new Date(run.created_at)))!==week||weekOf(koreaDate(new Date(run.updated_at)))!==week)return false;
 if(artifact.expired||artifact.name!==`cloudflare-production-${run.head_sha}`||artifact.digest!==`sha256:${archiveDigest}`||tree.truncated)return false;
 const indexed=new Map(tree.tree.filter(x=>x.type==='blob').map(x=>[x.path,x.sha]));
 if(!Object.entries(blobs).every(([path,sha])=>indexed.get(path)===sha))return false;
 if(build.gitSha!==run.head_sha||verified.gitSha!==run.head_sha||manifest.gitSha!==run.head_sha||build.producerProof?.status!=='FULL_REQUIRED'||
  build.assetManifestSha256!==verified.assetManifestSha256||verified.assetManifestSha256!==hash(JSON.stringify(manifest))||
  verified.schemaVersion!==2||typeof verified.workerVersionId!=='string'||!verified.workerVersionId||verified.workerVersionId==='local')return false;
 // Both old and new formats require evidence of a full regional computation.
 return build.fullVerification!==false&&build.regionPriceStats?.reusedGroups===0&&build.regionPriceStats?.computedGroups>0;
}
async function semanticTree(api,sha,blobs){
 const top=await api(`/git/trees/${sha}`),directories=[...new Set(Object.keys(blobs).filter(p=>p.includes('/')).map(p=>p.split('/')[0]))];
 const children=await Promise.all(directories.map(async directory=>{
  const entry=top.tree.find(x=>x.path===directory&&x.type==='tree');if(!entry)throw Error('Historical semantic code missing');
  const result=await api(`/git/trees/${entry.sha}?recursive=1`);
  return {...result,tree:result.tree.map(x=>({...x,path:directory+'/'+x.path}))};
 }));
 return {truncated:top.truncated||children.some(x=>x.truncated),tree:[...top.tree.filter(x=>x.type==='blob'),...children.flatMap(x=>x.tree)]};
}
export async function importCompletedCi(root,{token=process.env.GITHUB_TOKEN,repository=process.env.GITHUB_REPOSITORY,
 now=new Date(),engine=weeklyEngine(root),request=fetch}={}){
 if(!token||repository!=='ittodo/sudoapthistory')return {status:'NOT_IMPORTED',reason:'official-api-unavailable'};
 const dir=safe(root),week=weekOf(koreaDate(now));let blobs;
 try{blobs=semanticBlobs(root);}catch{return {status:'NOT_IMPORTED',reason:'unknown-semantic-dependency'};}
 const api=async path=>{const response=await request('https://api.github.com/repos/'+repository+path,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Official CI evidence API unavailable');return response.json();};
 try{
  const runs=await api('/actions/workflows/cloudflare-production.yml/runs?branch=main&event=push&status=success&per_page=10');
  for(const run of runs.workflow_runs??[]){
   if(run.event!=='push'||run.head_branch!=='main'||run.conclusion!=='success'||weekOf(koreaDate(new Date(run.created_at)))!==week)continue;
   const artifacts=await api(`/actions/runs/${run.id}/artifacts`),artifact=artifacts.artifacts?.find(x=>x.name===`cloudflare-production-${run.head_sha}`&&!x.expired&&/^sha256:[a-f0-9]{64}$/.test(x.digest??''));if(!artifact)continue;
   const tree=await semanticTree(api,run.head_sha,blobs);if(tree.truncated||!Object.entries(blobs).every(([path,sha])=>tree.tree.some(x=>x.type==='blob'&&x.path===path&&x.sha===sha)))continue;
   // Follow the signed download redirect without forwarding the API credential.
   const initial=await request(`https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`,{headers:{Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(30000)});
   const location=initial.headers.get('location');if(initial.status!==302||!location||new URL(location).protocol!=='https:')continue;
   const response=await request(location,{signal:AbortSignal.timeout(30000)});if(!response.ok)continue;
   if(Number(response.headers.get('content-length'))>10*1024*1024)throw Error('CI archive exceeds evidence limit');
   const archive=Buffer.from(await response.arrayBuffer());if(archive.length>10*1024*1024||hash(archive)!==artifact.digest.slice(7))continue;
   mkdirSync(dir,{recursive:true});const path=join(dir,'ci-evidence-'+process.pid+'.zip');writeFileSync(path,archive);
   try{
    const names=execFileSync('unzip',['-Z1',path],{encoding:'utf8',maxBuffer:1024*1024}).trim().split(/\r?\n/).filter(x=>!x.endsWith('/'));
    const permitted=['public/deployment.json','public/deployment-manifest.json','verified-release.json','build-timings.json'];
    if(names.length!==4||new Set(names).size!==4||names.some(x=>!permitted.includes(x)))continue;
    const read=name=>JSON.parse(execFileSync('unzip',['-p',path,name],{maxBuffer:5*1024*1024}));
    const build=read('build-timings.json'),verified=read('verified-release.json'),manifest=read('public/deployment-manifest.json'),deployment=read('public/deployment.json');
    if(deployment.gitSha!==run.head_sha||deployment.assetManifestSha256!==verified.assetManifestSha256||
      !importable({run,artifact,tree,build,verified,manifest,archiveDigest:hash(archive),blobs,week}))continue;
    if(weeklyEngine(root)!==engine)throw Error('Semantic engine changed during CI evidence import');
    const body={schema:1,engine,week,full:true,gitSha:run.head_sha,assetManifestSha256:verified.assetManifestSha256,
     workerVersionId:verified.workerVersionId,completedAt:run.updated_at,origin:'official-ci-artifact',runId:run.id,artifactId:artifact.id,archiveDigest:hash(archive)};
    atomic(join(dir,receiptName),{...body,digest:hash(JSON.stringify(body))});return {status:'IMPORTED',week,runId:run.id,gitSha:run.head_sha};
   }finally{unlinkSync(path);}
  }
  return {status:'NOT_IMPORTED',reason:'matching-successful-full-evidence-missing'};
 }catch(error){console.error('Weekly evidence import unavailable; full verification remains required.');return {status:'NOT_IMPORTED',reason:'evidence-unavailable'};}
}
export function koreaDate(now=new Date()){
 if(!Number.isFinite(now.getTime()))throw Error('Valid observation time required');
 return new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
}
export function weekOf(day){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Valid Korea date required');
 const date=new Date(day+'T00:00:00Z');if(date.toISOString().slice(0,10)!==day)throw Error('Invalid Korea date');
 date.setUTCDate(date.getUTCDate()-date.getUTCDay());return date.toISOString().slice(0,10);
}
function safe(root){
 const dir=join(resolve(root),directory);let current=dir;
 for(;;){if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('Weekly evidence symlink');const parent=dirname(current);if(parent===current)break;current=parent;}
 return dir;
}
function json(path){if(lstatSync(path).isSymbolicLink()||lstatSync(path).size>256*1024)throw Error('Invalid weekly evidence file');return JSON.parse(readFileSync(path));}
function atomic(path,value){mkdirSync(dirname(path),{recursive:true});if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('Weekly evidence symlink');const temporary=path+'.'+process.pid+'.tmp';writeFileSync(temporary,JSON.stringify(value));renameSync(temporary,path);}
function valid(proof,engine,week){
 if(!proof||typeof proof!=='object')return false;const {digest,...body}=proof;
 return proof.schema===1&&digest===hash(JSON.stringify(body))&&proof.engine===engine&&proof.week===week&&proof.full===true&&
 /^[a-f0-9]{40}$/.test(proof.gitSha)&&/^[a-f0-9]{64}$/.test(proof.assetManifestSha256)&&
 typeof proof.workerVersionId==='string'&&proof.workerVersionId!==''&&proof.workerVersionId!=='local'&&
 typeof proof.completedAt==='string'&&Number.isFinite(Date.parse(proof.completedAt))&&weekOf(koreaDate(new Date(proof.completedAt)))===week;
}
export function select(root,{event=process.env.EVENT_NAME,now=new Date(),engine=weeklyEngine(root)}={}){
 const dir=safe(root),day=koreaDate(now),week=weekOf(day);let proof;
 try{proof=json(join(dir,receiptName));}catch{}
 const completed=valid(proof,engine,week)&&Date.parse(proof.completedAt)<=now.getTime();
 const manual=event==='workflow_dispatch',sunday=day===week;
 const selected={schema:1,day,week,engine,full:manual||(sunday&&!completed),
  reason:manual?'manual-full':sunday?(completed?'weekly-completed':'weekly-required'):'regular-input-checks'};
 // A selection is never a success receipt and cannot satisfy valid().
 atomic(join(dir,selectionName),selected);return selected;
}
export function record(root,{now=new Date(),engine=weeklyEngine(root),envFull=process.env.NODO_FULL_VERIFY==='1'}={}){
 const dir=safe(root),selection=json(join(dir,selectionName));
 if(selection.full!==true)return {status:'UNCHANGED',reason:'regular-build'};
 if(selection.schema!==1||selection.engine!==engine||!envFull)throw Error('Full verification selection/engine mismatch');
 const dist=join(resolve(root),'cloudflare/dist'),build=JSON.parse(readFileSync(join(dist,'build-timings.json'))),
  verified=JSON.parse(readFileSync(join(dist,'verified-release.json'))),raw=readFileSync(join(dist,'public/deployment-manifest.json')),
  manifest=JSON.parse(raw);
 if(build.fullVerification!==true||build.verificationEngine!==engine||build.producerProof?.status!=='FULL_REQUIRED')throw Error('Actual full build evidence missing');
 if(!/^[a-f0-9]{40}$/.test(build.gitSha)||manifest.gitSha!==build.gitSha||verified.gitSha!==build.gitSha||
  build.assetManifestSha256!==hash(raw)||verified.assetManifestSha256!==hash(raw)||verified.schemaVersion!==2||
  typeof verified.workerVersionId!=='string'||!verified.workerVersionId||verified.workerVersionId==='local')throw Error('Same SHA public verification evidence mismatch');
 if(weekOf(koreaDate(now))!==selection.week)throw Error('Full verification crossed weekly boundary; do not mark new week complete');
 const body={schema:1,engine,week:selection.week,full:true,gitSha:build.gitSha,assetManifestSha256:hash(raw),
  workerVersionId:verified.workerVersionId,completedAt:now.toISOString()};
 const proof={...body,digest:hash(JSON.stringify(body))};atomic(join(dir,receiptName),proof);
 return {status:'RECORDED',week:body.week,gitSha:body.gitSha};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 try{
  const mode=process.argv[2];if(mode==='select'){
   let result=select(root);if(result.full&&result.reason==='weekly-required'){console.log(JSON.stringify(await importCompletedCi(root)));result=select(root);}if(!process.env.GITHUB_ENV)throw Error('CI environment path required');
   writeFileSync(process.env.GITHUB_ENV,`NODO_FULL_VERIFY=${result.full?'1':'0'}\n`,{flag:'a'});console.log(JSON.stringify(result));
  }else if(mode==='record')console.log(JSON.stringify(record(root)));else throw Error('Use select or record');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
