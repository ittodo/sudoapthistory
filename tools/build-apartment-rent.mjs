import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function buildApartmentRent(root,{verify=false}={}){
 const read=p=>JSON.parse(readFileSync(join(root,p),'utf8'));
 const catalog=read('data/apartments/index.json'),manifest=read('data/contracts/index.json');
 const groups={},coverage={},sources={},records={};let total=0,linked=0;
 for(const p of manifest.partitions){
  if(!/^[a-z-]+\/\d{5}\/\d{6}\.json$/.test(p.path))throw Error('Invalid contract partition path');
  const path='data/contracts/'+p.path,bytes=readFileSync(join(root,path)),rows=JSON.parse(bytes).rows;
  if(!Array.isArray(rows)||rows.length!==p.count)throw Error('Contract count mismatch: '+path);
  sources[path]=hash(bytes);
  if(p.service!=='apartment-rent')continue;
  (coverage[p.lawd]??={})[p.month]=p.checkedAt;
  for(const r of rows){total++;const ref=catalog.lookup[r.aptSeq||r.entityId];if(!ref)continue;linked++;
   const id=ref[0],shard=ref[1];groups[shard]??={};const a=groups[shard][id]??={rows:[],districts:[]};
   if(!a.districts.includes(p.lawd))a.districts.push(p.lawd);
   a.rows.push(r);
  }
 }
 const outputs={};
 for(const [shard,group] of Object.entries(groups)){
  for(const [id,a] of Object.entries(group)){a.rows.sort((x,y)=>String(y.date).localeCompare(String(x.date)));records[id]={shard,areas:[...new Set(a.rows.map(r=>r.area))].sort((a,b)=>a-b),districts:a.districts,count:a.rows.length};}
  outputs['data/apartment-rent/'+shard+'.json']=JSON.stringify(group);
 }
 const shards=Object.fromEntries(Object.entries(outputs).map(([p,s])=>[p,hash(s)]));
 outputs['data/apartment-rent/index.json']=JSON.stringify({schema:1,unit:'만원',total,linked,records,coverage,shards,sources,contractsHash:hash(readFileSync(join(root,'data/contracts/index.json'))),catalogHash:hash(readFileSync(join(root,'data/apartments/index.json')))});
 for(const [p,s] of Object.entries(outputs)){if(verify){if(!existsSync(join(root,p))||readFileSync(join(root,p),'utf8')!==s)throw Error('Rent output out of date: '+p);}else{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);}}
 return {total,linked,apartments:Object.keys(records).length,files:Object.keys(outputs).length,verified:verify};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const i=process.argv.indexOf('--root');console.log(JSON.stringify(buildApartmentRent(i<0?resolve(dirname(fileURLToPath(import.meta.url)),'..'):resolve(process.argv[i+1]),{verify:process.argv.includes('--verify')})));}
