import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
const base=resolve(dirname(fileURLToPath(import.meta.url)),'native-projection');
const binary=resolve(process.env.NODO_RUST_BINARY||join(base,'target/debug/nodostream-projection-tests'+(process.platform==='win32'?'.exe':'')));
const hash=b=>createHash('sha256').update(b).digest('hex');
const provenance=JSON.parse(readFileSync(join(base,'provenance.json')));
for(const [name,proof] of Object.entries(provenance.files)){
 assert.equal(hash(readFileSync(join(base,'vendor',name))),proof.exportSha256,'Vendor changed: run explicit source sync');
 if(process.env.NODO_NATIVE_SOURCE){
  const source=readFileSync(join(process.env.NODO_NATIVE_SOURCE,'src',name));
  assert.equal(hash(source),proof.sourceSha256,'Canonical source changed: '+name);
 }
}
const manifest=JSON.parse(readFileSync(join(base,'fixtures/manifest.json')));
const temp=mkdtempSync(join(tmpdir(),'nodo-native-tests-'));
// Native subprocesses have no PATH: Python and other helper programs cannot run.
const env={...process.env,PATH:'',Path:''};
function invoke(command,spec,error){
 const p=spawnSync(binary,[command],{input:JSON.stringify(spec),encoding:'utf8',env,maxBuffer:16*1024*1024,timeout:60000});
 if(error){assert.notEqual(p.status,0);assert.match(p.stderr,error);return;}
 assert.equal(p.status,0,p.error?.message||p.stderr);return {result:JSON.parse(p.stdout).result,log:p.stderr};
}
function put(path,bytes){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);}
function files(dir,prefix=''){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name),prefix+e.name+'/'):[prefix+e.name]);}
function output(site,kind){return Object.fromEntries(files(join(site,'data',kind)).sort().map(p=>['data/'+kind+'/'+p,hash(readFileSync(join(site,'data',kind,p)))]));}
function expectedResult(c,site){
 const result=structuredClone(c.result);
 for(const p of Object.keys(result.sources)){
  const actual=hash(readFileSync(join(site,p)));
  if(!p.startsWith('data/'+c.kind+'/'))assert.equal(actual,result.sources[p],'Original input bytes changed: '+p);
  result.sources[p]=actual;
 }
 const text=c.kind==='daily'?'{'+Object.keys(result.sources).sort().map(k=>JSON.stringify(k)+': '+JSON.stringify(result.sources[k])).join(', ')+'}':JSON.stringify(result.sources);
 result.version=hash(text).slice(0,16);return result;
}
function verify(site,c){
 const actual=output(site,c.kind);assert.deepEqual(Object.keys(actual).sort(),Object.keys(c.expected).sort());
 for(const [p,h]of Object.entries(actual)){
  if(p.endsWith('/index.json'))continue;
  if(p.endsWith('.bin'))assert.equal(hash(gunzipSync(readFileSync(join(site,p)))),c.payloads[p],p+' decoded bytes');
  else assert.equal(h,c.expected[p],p);
 }
 assert.deepEqual(JSON.parse(readFileSync(join(site,'data',c.kind,'index.json'))),expectedResult(c,site));
 invoke(c.kind+'-validate',{site});
}
function install(c,folder,root){
 mkdirSync(root,{recursive:true});
 for(const name of ['database','missing'])if(existsSync(join(folder,name+'.sql'))){
  const path=join(root,name+'.db');rmSync(path,{force:true});const db=new DatabaseSync(path);db.exec(readFileSync(join(folder,name+'.sql'),'utf8'));db.close();
 }
 for(const [name,value]of Object.entries(c.inputs)){
  const path=join(name.startsWith('_ops/')||name==='rates.json'?root:join(root,'site'),name);
  const bytes=Buffer.from(JSON.stringify(value));put(path,c.inputBytes?.[name]?Buffer.from(c.inputBytes[name],'base64'):name.endsWith('.bin')?gzipSync(bytes):bytes);
 }
 const spec={site:join(root,'site'),database:join(root,'database.db'),today:'2026-09-20',updated:c.result.updated||'2026-09-20T00:00:00+00:00'};
 if(c.kind==='daily'){spec.missing=join(root,'missing.db');spec.cache_dir=join(root,'cache');if(c.monthly)spec.ledger_root=root;}
 else {spec.cache=join(root,'cache');spec.rates_path=join(root,'rates.json');}
 return spec;
}
let cases=0;
try{
 for(const entry of manifest.cases){
  const folder=join(base,'fixtures',entry.id),c=JSON.parse(readFileSync(join(folder,'case.json'))),root=join(temp,String(c.group));
  const spec=install(c,folder,root),original=hash(readFileSync(spec.database));
  const first=invoke(c.kind+'-build',spec);assert.deepEqual(first.result,expectedResult(c,spec.site),c.id+' result');verify(spec.site,c);
  const warm=invoke(c.kind+'-build',spec);assert.deepEqual(warm.result,first.result);verify(spec.site,c);
  if(c.test.includes('monthly_scans_zero'))assert.match(warm.log,/daily rows scanned: 0/);
  const cacheDir=spec.cache_dir||spec.cache,checkpoint=files(cacheDir).filter(p=>c.kind==='daily'?p.endsWith('.json'):/^state-.*\.bin$/.test(p)).sort().at(-1);
  if(checkpoint){writeFileSync(join(cacheDir,checkpoint),'{broken');invoke(c.kind+'-build',spec);verify(spec.site,c);}
  assert.equal(hash(readFileSync(spec.database)),original,'Source DB modified');
  // Preserve historical correction sequences within each group; test cold recovery too.
  const corrupt=Object.keys(c.expected).find(p=>p.endsWith('.bin'));writeFileSync(join(spec.site,corrupt),'broken');
  invoke(c.kind+'-validate',{site:spec.site},/changed|invalid|gzip|header|magic|unexpected/i);
  if(c.kind==='daily')rmSync(spec.cache_dir,{recursive:true,force:true});else rmSync(spec.cache,{recursive:true,force:true});
  invoke(c.kind+'-build',spec);verify(spec.site,c);
  if(c.kind==='daily'){
   const stage=join(root,'stage');put(join(stage,'data/map/index.json'),readFileSync(join(spec.site,'data/map/index.json')));
   const {cache_dir,ledger_root,...uncached}=spec;
   const reuse=invoke('daily-build',{...uncached,site:stage,previous_site:spec.site});assert.match(reuse.log,/"compressed":0/);verify(stage,c);assert.deepEqual(output(stage,'daily'),output(spec.site,'daily'));
   const guard=join(root,'guard.json');put(guard,JSON.stringify({site_publish_allowed:false}));invoke('daily-build',{...spec,guard},/blocked/);
   put(guard,JSON.stringify({site_publish_allowed:true,projection_in_progress:true}));invoke('daily-build',{...spec,guard},/blocked/);
  }
  cases++;console.log(c.id+' '+c.kind+' fixed outputs, warm cache, corruption recovery passed');
 }
 const root=join(temp,'negative'),fixture=join(base,'fixtures',manifest.cases.find(c=>c.kind==='rental').id),c=JSON.parse(readFileSync(join(fixture,'case.json'))),spec=install(c,fixture,root);
 const db=new DatabaseSync(spec.database);db.exec("UPDATE contract_record SET payload=json_set(payload,'$.property','officetel') WHERE ordinal=0");db.close();
 const original=hash(readFileSync(spec.database));invoke('rental-build',spec,/Wrong rental property/);assert.equal(hash(readFileSync(spec.database)),original);
 const response={DATA:['서울','경기','인천'].map(r=>({CATE1:r,COL_202501100001OD:'4.5',COL_202502100001OD:'-',other:1}))};
 const request={destination:join(root,'rate-result.json'),today:'2026-09-20',fetched_at:'2026-09-20T00:00:00+00:00',response};
 const rate=invoke('rental-rates',request).result;assert.deepEqual(rate.rates,{'11':{'2025-01':4.5},'41':{'2025-01':4.5},'28':{'2025-01':4.5}});
 assert.deepEqual(invoke('rental-rates',{...request,response:{}}).result,rate);
 const saved=readFileSync(request.destination);
 for(const invalid of [{DATA:[]},{DATA:response.DATA.map(x=>({CATE1:x.CATE1,COL_202502100001OD:'5'}))},{DATA:response.DATA.map(x=>({CATE1:x.CATE1,COL_202501100001OD:'101'}))}]){invoke('rental-rates',{...request,force:true,response:invalid},/./);assert.deepEqual(readFileSync(request.destination),saved);}
 for(const mutation of ['map','projection']){
  const folder=join(base,'fixtures',manifest.cases.find(x=>x.kind==='daily').id),c=JSON.parse(readFileSync(join(folder,'case.json'))),root=join(temp,'drift-'+mutation),spec=install(c,folder,root);
  delete spec.cache_dir;delete spec.ledger_root;
  const db=new DatabaseSync(spec.database);db.exec("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<30000) INSERT INTO transactions SELECT 'A',84.9,2026,3,4,100+x,3,'','11','202603',1,1000+x,'stress-'||x FROM n");db.close();
  await new Promise((resolve,reject)=>{
   const child=spawn(binary,['daily-build'],{env,stdio:['pipe','pipe','pipe']});let log='',changed=false,pendingError;
   const timer=setTimeout(()=>{pendingError=Error('Drift test timed out');child.kill();},60000);
   child.stdout.resume();child.on('error',e=>{clearTimeout(timer);reject(e);});
   child.stderr.on('data',chunk=>{log+=chunk;if(!changed&&log.includes('daily checkpoint:')){
    changed=true;
    try{if(mutation==='map')put(join(spec.site,'data/map/index.json'),JSON.stringify({meta:{sourceVersion:'changed'},d:[]}));
    else{const d=new DatabaseSync(spec.database);try{d.exec("PRAGMA busy_timeout=5000; UPDATE build_meta SET value='changed' WHERE key='trade_source_revision'");}finally{d.close();}}}
    catch(e){pendingError=e;child.kill();}
   }});
   child.on('close',code=>{clearTimeout(timer);try{if(pendingError)throw pendingError;assert.ok(changed);assert.notEqual(code,0);assert.match(log,mutation==='map'?/Map changed/:/Projection changed/);assert.equal(existsSync(join(spec.site,'data/daily/index.json')),false);resolve();}catch(e){reject(e);}});
   child.stdin.end(JSON.stringify(spec));
  });
 }
 console.log(JSON.stringify({status:'PASSED',goldenScenarios:cases,nativeSubprocessPath:'empty',pythonInvocations:0}));
}finally{rmSync(temp,{recursive:true,force:true});}
