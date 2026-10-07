import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import {join,resolve,dirname,sep} from 'node:path';
const digest = x => createHash('sha256').update(x).digest('hex');
// Receipts are an optimization of successful checks, never an alternative to
// verifying current inputs. The engine key includes every local reader/model.
export function fullValidationEngine(root) {
 const files=[];
 function walk(directory,prefix){if(!existsSync(directory))return;for(const entry of readdirSync(directory,{withFileTypes:true})){
  const path=join(directory,entry.name),name=prefix+entry.name;
  if(lstatSync(path).isSymbolicLink())throw Error('Validation engine symlink');
  if(entry.isDirectory()){if(!['target','node_modules','dist','.git','.cache'].includes(entry.name))walk(path,name+'/');}else if(/\.(?:m?js|cjs|json)$/.test(name))files.push([name,digest(readFileSync(path))]);
 }}
 for(const name of ['tools','js'])walk(join(root,name),name+'/');
 return digest(JSON.stringify(files.sort((a,b)=>a[0].localeCompare(b[0],'en'))));
}
export function codeDependencyEngine(root,{roots}={}) {
 root=resolve(root);const files=new Map();
 try {
  function visit(path){path=resolve(path);if(!path.startsWith(root+sep)||lstatSync(path).isSymbolicLink()||realpathSync(path).toLowerCase()!==path.toLowerCase())throw Error('Unsafe engine dependency');const name=path.slice(root.length+1).replaceAll('\\','/');if(files.has(name))return;
   const bytes=readFileSync(path),source=bytes.toString();files.set(name,digest(bytes));
   if(/\b(?:import|require)\s*\(\s*[^'"\s]/.test(source))throw Error('Dynamic validation dependency');
   for(const match of source.matchAll(/['"](\.{1,2}\/[^'"\n]+\.(?:m?js|cjs|json))['"]/g))visit(resolve(dirname(path),match[1]));
  }
  for(const name of roots)visit(join(root,name));
  return digest(JSON.stringify({schema:2,files:[...files].sort((a,b)=>a[0].localeCompare(b[0],'en'))}));
 } catch {return fullValidationEngine(root);}
}
