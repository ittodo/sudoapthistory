// Local calculator packaging only. Never import the site/data/cache builders here.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const calculatorAssets=Object.freeze([
  'calc/holding-tax.html', 'js/holding-tax.js', 'js/holding-tax-app.js', 'js/transaction-tax.js', 'js/transaction-tax-app.js',
  'css/holding-tax.css', 'css/site.css', 'css/responsive.css',
  'js/site-theme.js', 'js/site-shell.js', 'js/apartment-links.js',
  'js/member-library.js', 'js/auth-client.js', 'js/page-analytics.js',
]);
function rejectLinks(root,path){
  let current=root;
  if(lstatSync(current).isSymbolicLink())throw Error('Symlink root');
  for(const part of path.split('/')){
    current=join(current,part);
    if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('Symlink: '+path);
  }
}
export function buildCalculator(root, {scope='holding-tax-local', assets=calculatorAssets} = {}){
  if(!/^[a-z-]+-local$/.test(scope))throw Error('Invalid local scope');
  root=resolve(root);
  const relative='cloudflare/dist/'+scope,output=join(root,relative);
  rejectLinks(root,relative);
  // Read all inputs first; missing dependencies must fail, not silently disappear.
  const inputs=assets.map(path=>{
    if(!/^(calc|js|css)\/[a-zA-Z0-9._-]+$/.test(path))throw Error("Invalid calculator asset");
    rejectLinks(root,path);
    return {path,bytes:readFileSync(join(root,path))};
  });
  let written=0;
  for(const {path,bytes} of inputs){
    rejectLinks(root,relative+'/'+path);
    const target=join(output,path);
    mkdirSync(dirname(target),{recursive:true});
    if(!existsSync(target)||!readFileSync(target).equals(bytes)){writeFileSync(target,bytes);written++;}
  }
  const manifest={schema:1,scope,deployable:false,files:inputs.map(({path,bytes})=>({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}))};
  rejectLinks(output,'local-manifest.json');
  writeFileSync(join(output,'local-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return {scope:manifest.scope,output,assets:inputs.length,written,regionalCaches:'not invoked'};
}
export function buildHoldingTax(root){return buildCalculator(root);}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(buildHoldingTax(resolve(import.meta.dirname,'..'))));
