// Small deterministic entry points replace the national manifest on detail reads.
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function buildApartmentEntries(root,{fallback=null}={}){
 const read=p=>readFileSync(join(existsSync(join(root,p))?root:fallback??root,p));
 const catalog=JSON.parse(read('data/apartments/index.json')),saleBytes=read('data/sale-details/index.json'),rentBytes=read('data/apartment-rent/index.json'),sale=JSON.parse(saleBytes),rent=JSON.parse(rentBytes);
 if(sale.format!=='sale-fact-references'||rent.schema!==2)throw Error('Shared transaction references required');
 const indexPath=join(root,'data/apartments/entry-index.json'),oldIndex=existsSync(indexPath)?JSON.parse(readFileSync(indexPath)):null;
 const buckets=Object.fromEntries(Array.from({length:64},(_,i)=>[i.toString(16).padStart(2,'0'),{schema:3,lookup:{},legacy:{},routes:{}}]));
 const bucket=s=>buckets[(parseInt(hash(s).slice(0,2),16)&63).toString(16).padStart(2,'0')];
 const ref=id=>{const r=catalog.lookup[id];if(!r)return null;for(const prefix of ['','summary/']){const path=`data/apartments/${prefix}${r[1]}.${catalog.format==='packed-records-v1'?'bin':'json'}`,sha256=catalog.shards[path];if(prefix&&catalog.format!=='packed-records-v1'&&!sha256)continue;if(!/^[a-f0-9]{64}$/.test(sha256||''))throw Error('Missing apartment shard hash');}return [r[0],r[1]];};
 for(const id of Object.keys(catalog.lookup))bucket(id).lookup[id]=ref(id);
 for(const[row,[id,area]]of Object.entries(catalog.legacy||{})){const target=ref(id);if(!target)throw Error('Missing legacy apartment');bucket('row:'+row).legacy[row]=[...target,area];}
 const descriptor=JSON.parse(read('data/daily/regions/index.json'));
 for(const[region,paths]of Object.entries(descriptor.regions)){if(!/^\d{5}$/.test(region))throw Error('Invalid source region');const identity=JSON.parse(read(paths.identities));identity.complexes.forEach((id,local)=>{if(Object.hasOwn(bucket(id).routes,id))throw Error('Repeated source identity');bucket(id).routes[id]={region,local};});}
 // Published metadata-only apartments also have a valid empty transaction view.
 for(const id of Object.keys(catalog.lookup))bucket(id).routes[id]??=null;
 const files={};let bytes=0,written=0;
 for(const[path,digest]of Object.entries(oldIndex?.sources||{}))if(/^data\/apartments\/entry\/[4-9a-f][a-f0-9]\.json$/.test(path)){const target=join(root,path);if(hash(readFileSync(target))!==digest)throw Error('Obsolete entry changed');rmSync(target);}
 for(const[key,value]of Object.entries(buckets)){const path=`data/apartments/entry/${key}.json`,data=Buffer.from(JSON.stringify(value)),target=join(root,path);mkdirSync(dirname(target),{recursive:true});if(!existsSync(target)||!readFileSync(target).equals(data)){writeFileSync(target,data);written++;}files[path]=hash(data);bytes+=data.length;}
 const metadata={version:catalog.version,format:catalog.format,updated:catalog.updated,...(Object.hasOwn(catalog,'propertyUpdated')?{propertyUpdated:catalog.propertyUpdated}:{}),sources:catalog.sources};
 const index={schema:3,metadata,basis:{sale:hash(saleBytes),rental:hash(rentBytes),catalog:hash(read('data/apartments/index.json'))},shards:catalog.shards,sources:files},path=join(root,'data/apartments/entry-index.json'),data=Buffer.from(JSON.stringify(index));if(!existsSync(path)||!readFileSync(path).equals(data))writeFileSync(path,data);return {files,bytes,written};
}
