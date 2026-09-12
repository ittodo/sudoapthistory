import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,lstatSync,rmSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {forbiddenReason} from './verify-site-layout.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const injection = '<script src="/deployment-version.js"></script>';
export function publicAsset(path) {
  if (path.split('/').some(p => p.startsWith('.') || /^(docs|tools|cloudflare|supabase|schemas|tests?|logs?)$/i.test(p))) return false;
  if (forbiddenReason(path)) return false;
  if (/^data\//.test(path)) return /\.(json|bin)$/i.test(path) && !/(secret|credential|token|backup)/i.test(path);
  if(path.includes('/') && !/^(account|admin|calc|compare|css|div|js|map|market|stats|trades|assets|images|fonts)\//.test(path)) return false;
  return /\.(html|css|js|png|jpg|jpeg|webp|gif|svg|ico|woff2?)$/i.test(path) || ['ads.txt','robots.txt','sitemap.xml'].includes(path);
}
export function runtime(sha) {
  return `window.__NODESTREAM_RELEASE__=${JSON.stringify(sha)};(()=>{const original=window.fetch;window.fetch=function(input,init){const url=new URL(input instanceof Request?input.url:input,location.href);if(url.origin===location.origin&&url.pathname.startsWith('/data/')&&url.pathname.endsWith('.json')&&((init&&init.method)||(input instanceof Request?input.method:'GET')).toUpperCase()==='GET'){url.searchParams.set('v',window.__NODESTREAM_RELEASE__);input=input instanceof Request?new Request(url,input):url.href;}return original.call(this,input,init);};})();\n`;
}
export function build(root, output, sha) {
  root=resolve(root); output=resolve(output);
  if (output!==join(root,'cloudflare','dist','public')) throw new Error('Output must be isolated cloudflare/dist/public');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Full Git SHA required');
  const paths=[...new Set(execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p && existsSync(join(root,p))))];
  const assets=[];
  for(const path of paths) {
    if(forbiddenReason(path)) throw new Error(`Forbidden tracked output: ${path}`);
    if(!publicAsset(path)) continue;
    let current=root;
    for(const part of path.split('/')) {current=join(current,part);if(lstatSync(current).isSymbolicLink()) throw new Error(`Symlink: ${path}`);}
    let bytes=readFileSync(current);
    if(path.endsWith('.html')) {
      const html=bytes.toString('utf8');
      if(!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error(`Missing head: ${path}`);
      bytes=Buffer.from(html.replace(/<head(?:\s[^>]*)?>/i,match=>match+injection));
    }
    if(bytes.length>25*1024*1024) throw new Error(`Asset exceeds 25 MiB: ${path}`);
    assets.push({path,bytes});
  }
  assets.push({path:'deployment-version.js',bytes:Buffer.from(runtime(sha))});
  if(assets.length+3>20000) throw new Error('Asset count exceeds free tier 20000');
  assets.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  const manifest=JSON.stringify({schema:1,gitSha:sha,files:assets.map(f=>({path:f.path,sha256:sha256(f.bytes),bytes:f.bytes.length}))});
  // Only this known generated directory is ever replaced; never clean the source tree.
  for(const part of [join(root,'cloudflare'),join(root,'cloudflare','dist'),output])if(existsSync(part)&&lstatSync(part).isSymbolicLink())throw new Error('Symlink output parent');
  if(existsSync(output)) rmSync(output,{recursive:true});
  for(const f of assets) {const target=join(output,f.path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,f.bytes);}
  writeFileSync(join(output,'deployment-manifest.json'),manifest);
  writeFileSync(join(output,'deployment.json'),JSON.stringify({schema:1,gitSha:sha,assetManifestSha256:sha256(manifest)}));
  writeFileSync(join(output,'_headers'),'/*\n  Cache-Control: public, max-age=0, must-revalidate\n  X-Content-Type-Options: nosniff\n');
  return {gitSha:sha,count:assets.length,assetManifestSha256:sha256(manifest)};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const sha=process.env.GITHUB_SHA || execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  console.log(JSON.stringify(build(root,join(root,'cloudflare/dist/public'),sha)));
}
