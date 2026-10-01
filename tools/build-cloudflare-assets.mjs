import {validate as validateCofix} from './collect-cofix.mjs';
import {dataValidationProof} from './data-validation-proof.mjs';
import {performance} from 'node:perf_hooks';
import {ValidationSession,manifestDependencies} from './validation-session.mjs';
import {operationsMetadata} from './operations-metadata.mjs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,lstatSync,rmSync,readdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {forbiddenReason} from './verify-site-layout.mjs';
import {verifyApartmentRent} from './verify-apartment-rent.mjs';
import {verifyApartmentSale} from './verify-apartment-sale.mjs';
import {verifyDailyData} from './verify-daily-data.mjs';
import {verifyRentalData} from './verify-rental-data.mjs';
import {searchAssets} from './build-search-data.mjs';
import {regionPriceAssets} from './build-region-price-cache.mjs';
import {rentalMapAssets} from './build-rental-map-cache.mjs';
import {rentalMarketAssets} from './build-rental-market-cache.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const injection = '<script src="/deployment-version.js"></script>';
export function publicAsset(path) {
  if (path.split('/').some(p => p.startsWith('.') || /^(docs|tools|cloudflare|supabase|schemas|tests?|logs?)$/i.test(p))) return false;
  if (forbiddenReason(path)) return false;
  if (/^data\//.test(path)) return /\.(json|bin)$/i.test(path) && !/(secret|credential|token|backup)/i.test(path);
  if(path.includes('/') && !/^(account|admin|apartment|board|library|ranking|calc|compare|css|div|js|map|market|stats|trades|assets|images|fonts)\//.test(path)) return false;
  return /\.(html|css|m?js|png|jpg|jpeg|webp|gif|svg|ico|woff2?)$/i.test(path) || ['ads.txt','robots.txt','sitemap.xml'].includes(path);
}
export function runtime(sha) {
  return `window.__NODESTREAM_RELEASE__=${JSON.stringify(sha)};(()=>{const original=window.fetch;window.fetch=function(input,init){const url=new URL(input instanceof Request?input.url:input,location.href);if(url.origin===location.origin&&url.pathname.startsWith('/data/')&&url.pathname.endsWith('.json')&&((init&&init.method)||(input instanceof Request?input.method:'GET')).toUpperCase()==='GET'){url.searchParams.set('v',window.__NODESTREAM_RELEASE__);input=input instanceof Request?new Request(url,input):url.href;}return original.call(this,input,init);};})();\n`;
}
export function build(root, output, sha) {
  root=resolve(root); output=resolve(output);
  if (output!==join(root,'cloudflare','dist','public')) throw new Error('Output must be isolated cloudflare/dist/public');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Full Git SHA required');
  const started=performance.now(),timings={};
  const phase=(name,fn)=>{const begin=performance.now();try{return fn();}finally{timings[name]=(performance.now()-begin)/1000;console.error(JSON.stringify({phase:name,seconds:timings[name]}));}};
  if(existsSync(join(root,'js/market-cofix.js')))phase('cofix',()=>validateCofix(JSON.parse(readFileSync(join(root,'data/market-rates/cofix.json'),'utf8')),new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date())));
  const validation=new ValidationSession(root);
  const checked=(name,manifests,fn)=>phase(name,()=>validation.check(name,manifestDependencies(root,manifests),fn));
  const producerProof=phase('producer-proof',()=>dataValidationProof(root));
  if(producerProof.status!=='VERIFIED'){
  if(existsSync(join(root,'apartment/index.html')) || existsSync(join(root,'data/apartments/index.json'))) checked('sale-details',['data/apartments/index.json','data/sale-details/index.json','data/daily/index.json'],()=>verifyApartmentSale(root));
  if(existsSync(join(root,'js/apartment-rent.js'))) checked('rental-details',['data/contracts/index.json','data/apartment-rent/index.json','data/apartments/index.json','data/rental/index.json'],()=>verifyApartmentRent(root));
  if(existsSync(join(root,'trades/daily/index.html'))&&!existsSync(join(root,'data/daily/index.json')))throw Error('Daily page requires its data manifest');
  phase('common-trades',()=>{verifyDailyData(root);verifyRentalData(root);});
  validation.flush();
  }
  const paths=[...new Set(execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p && existsSync(join(root,p))))];
  const assets=[];
  for(const path of paths) {
    if(forbiddenReason(path)) throw new Error(`Forbidden tracked output: ${path}`);
    if(!publicAsset(path)) continue;
    let current=root;
    for(const part of path.split('/')) {current=join(current,part);if(lstatSync(current).isSymbolicLink()) throw new Error(`Symlink: ${path}`);}
    if(lstatSync(current).size>25*1024*1024) throw new Error(`Asset exceeds 25 MiB: ${path}`);
    let bytes=readFileSync(current);
    if(path.endsWith('.html')) {
      const html=bytes.toString('utf8');
      if(!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error(`Missing head: ${path}`);
      bytes=Buffer.from(html.replace(/<head(?:\s[^>]*)?>/i,match=>match+injection));
    }
    if(bytes.length>25*1024*1024) throw new Error(`Asset exceeds 25 MiB: ${path}`);
    assets.push({path,source:current,sha256:sha256(bytes),size:bytes.length});
  }
  if(existsSync(join(root,'js/admin-center.js'))) assets.push({path:'data/operations-status.json',bytes:Buffer.from(JSON.stringify(operationsMetadata(root)))});
  const generatedSearch=phase('search',()=>searchAssets(root));
  for(const f of generatedSearch)if(f.bytes.length>25*1024*1024)throw Error('Search asset exceeds 25 MiB: '+f.path);
  const catalog=generatedSearch.find(f=>f.path==='data/search/apartments.json');
  if(catalog)for(const [path,hash]of Object.entries(JSON.parse(catalog.bytes).sources)){
    if(assets.find(f=>f.path===path)?.sha256!==hash)throw Error('Search source changed during packaging: '+path);
  }
  assets.push(...generatedSearch,...phase('rental-map',()=>rentalMapAssets(root)),...phase('rental-market',()=>rentalMarketAssets(root)),...phase('region-prices',()=>regionPriceAssets(root)));
  const packagingStarted=performance.now();
  assets.push({path:'deployment-version.js',bytes:Buffer.from(runtime(sha))});
  if(assets.length+3>20000) throw new Error('Asset count exceeds free tier 20000');
  assets.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  const manifest=JSON.stringify({schema:1,gitSha:sha,files:assets.map(f=>({path:f.path,sha256:f.sha256??sha256(f.bytes),bytes:f.size??f.bytes.length}))});
  // Only this known generated directory is ever replaced; never clean the source tree.
  for(const part of [join(root,'cloudflare'),join(root,'cloudflare','dist'),output])if(existsSync(part)&&lstatSync(part).isSymbolicLink())throw new Error('Symlink output parent');
  const wanted=new Set([...assets.map(f=>f.path),'deployment-manifest.json','deployment.json','_headers']);
  function prune(directory,prefix='') {
    if(!existsSync(directory))return;
    for(const entry of readdirSync(directory,{withFileTypes:true})) {
      const path=join(directory,entry.name),relative=prefix+entry.name;
      if(lstatSync(path).isSymbolicLink())throw new Error('Symlink output entry');
      if(entry.isDirectory())prune(path,relative+'/');
      else if(!wanted.has(relative))rmSync(path);
    }
  }
  prune(output);
  let reused=0,written=0;
  function emit(path,bytes){const target=join(output,path);bytes=Buffer.from(bytes);mkdirSync(dirname(target),{recursive:true});if(existsSync(target)&&readFileSync(target).equals(bytes)){reused++;return;}writeFileSync(target,bytes);written++;}
  for(const f of assets) {
    let bytes=f.bytes??readFileSync(f.source);
    if(f.source && f.path.endsWith('.html')) bytes=Buffer.from(bytes.toString('utf8').replace(/<head(?:\s[^>]*)?>/i,match=>match+injection));
    if(f.source && sha256(bytes)!==f.sha256) throw Error('Asset changed during packaging: '+f.path);
    emit(f.path,bytes);
  }
  emit('deployment-manifest.json',manifest);
  emit('deployment.json',JSON.stringify({schema:1,gitSha:sha,assetManifestSha256:sha256(manifest)}));
  emit('_headers','/*\n  Cache-Control: public, max-age=0, must-revalidate\n  X-Content-Type-Options: nosniff\n');
  timings.packaging=(performance.now()-packagingStarted)/1000;timings.total=(performance.now()-started)/1000;
  const result={gitSha:sha,count:assets.length,assetManifestSha256:sha256(manifest),reused,written,timings,producerProof,validation:validation.stats};
  writeFileSync(join(root,'cloudflare/dist/build-timings.json'),JSON.stringify(result));
  return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const sha=process.env.GITHUB_SHA || execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  console.log(JSON.stringify(build(root,join(root,'cloudflare/dist/public'),sha)));
}
