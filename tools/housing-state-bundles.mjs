import {createHash} from 'node:crypto';
import {encodeStateBundle,stateBundle} from '../js/housing-state-bundle.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Keep established partitions when a year cannot fit in a single asset.
export function bundleStateYear(code,year,paths,sources,read,emit,retire,{maxBytes=20*1024*1024}={}){
 const parts={};let oldBytes=0;
 for(const[kind,path]of Object.entries(paths)){
  if(path===null)continue;
  if(path!==`data/daily/regions/${code}/states/${kind}/${year}.bin`)return null;
  const bytes=read(path);if(hash(bytes)!==sources[path])throw Error('State source changed');parts[kind]={bytes,sha256:sources[path]};oldBytes+=bytes.length;
 }
 if(!Object.keys(parts).length||oldBytes>maxBytes)return null;
 const bytes=encodeStateBundle(code,year,parts);if(bytes.length>maxBytes)return null;
 const path=`data/daily/regions/${code}/states/${year}.bin`;emit(path,bytes);
 for(const old of Object.values(paths).filter(Boolean))retire(old,sources[old]);
 return {path,bytes:bytes.length,oldBytes,oldFiles:Object.keys(parts).length,sections:stateBundle(bytes).sections};
}
export function stateSections(states,kind,read){
 const result={};for(const path of new Set(Object.values(states).flatMap(x=>Object.values(x)).filter(p=>p&&/^data\/daily\/regions\/\d{5}\/states\/\d{4}\.bin$/.test(p)))){
  const b=stateBundle(read(path),{lawd:path.split('/')[3],year:path.split('/').at(-1).slice(0,4)});if(!b.sections[kind])throw Error('Missing annual state kind');result[path]=b.sections[kind];
 }return result;
}
