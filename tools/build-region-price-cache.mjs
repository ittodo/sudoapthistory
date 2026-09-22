import {readFileSync,writeFileSync,existsSync,mkdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import vm from 'node:vm';

const hash=b=>createHash('sha256').update(b).digest('hex'),prefix='data/map/price-cache/';
const models=['map-model','daily-model','rental-model','rental-map-model'];
export function regionModels(root){const ctx=vm.createContext({});for(const name of models)vm.runInContext(readFileSync(join(root,'js',name+'.js'),'utf8'),ctx);return ctx;}
export function packFrames(days,snapshot){
  let previous=new Map(),previousPoints=new Map();const updates=[];let opening;
  for(const day of days){const value=snapshot(day),next=new Map(value.regions),changed=[],points=new Map((value.meta.points||[]).map(p=>[p.ci,p])),pointChanges=[];
    delete value.meta.points;
    for(const [id,p]of points)if(JSON.stringify(p)!==JSON.stringify(previousPoints.get(id)))pointChanges.push([id,p]);
    for(const id of previousPoints.keys())if(!points.has(id))pointChanges.push([id,null]);
    for(const [id,row]of next)if(JSON.stringify(row)!==JSON.stringify(previous.get(id)))changed.push([id,row]);
    for(const id of previous.keys())if(!next.has(id))changed.push([id,null]);
    if(!opening)opening={...value,points:[...points]};else updates.push({day,regions:changed,points:pointChanges,meta:value.meta});previous=next;previousPoints=points;
  }
  return {schema:1,opening,updates};
}
export function rentalFrames(ctx,catalog,shard,month,region,type){
  const model=ctx.NodoRentalMapModel.create(catalog),days=[month+'-00',...new Set(shard.updates.map(r=>ctx.NodoRental.iso(r[2])))].sort();
  return packFrames(days,day=>{
    const raw=model.mapView([shard],[region],{day,type,contract:'all',kind:'all',compactMap:true,convert:false,bundle:true});
    return {regions:raw.totals,meta:{count:raw.count,complexCount:raw.complexCount,stats:raw.stats,points:raw.points}};
  });
}
export function saleFrames(ctx,catalog,payload,shard,month){
  const original=new Map(payload.d.flatMap(c=>[[c.id,c],...(c.memberSources||[]).map(s=>[s.id,c])])),group=ctx.NodoMapModel.createPriceGroups(catalog,original,ctx.NodoDailyModel),cursor=ctx.NodoDailyModel.priceCursor(shard);
  const days=[month+'-00',...new Set(shard.updates.map(r=>ctx.NodoDailyModel.iso(r[1])))].sort();
  return packFrames(days,day=>{
    const f=cursor.seek(Number(day.replaceAll('-',''))),result=group.update({values:[f.values],changes:f.events,reset:f.reset},{});
    const matches=result.complexes.map(c=>ctx.NodoMapModel.match(c,{})).filter(Boolean);
    return {regions:[...ctx.NodoMapModel.regionGroups(matches)].map(([id,members])=>{const s=ctx.NodoMapModel.clusterTotals(members);return [id,[s.count,s.pricedCount,s.sum]];}),meta:{complexCount:matches.length,count:matches.length}};
  });
}
export function regionPriceAssets(root,{months}={}){
  if(!existsSync(join(root,'data/map/index.json'))||!existsSync(join(root,'data/daily/index.json'))||!existsSync(join(root,'data/rental/index.json')))return [];
  const ctx=regionModels(root),assets=[],sources={},inputs={},directory=join(root,'cloudflare/dist/region-price-cache-v1');
  for(const p of [join(root,'cloudflare'),join(root,'cloudflare/dist'),directory])if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('Symlink region cache output');mkdirSync(directory,{recursive:true});
  const read=p=>readFileSync(join(root,p)),json=p=>JSON.parse(read(p)),payload=json('data/map/index.json'),sale=json('data/daily/index.json'),rental=json('data/rental/index.json');
  const verified=(path,manifest)=>{const b=read(path);if(hash(b)!==manifest.sources[path])throw Error('Region cache input changed: '+path);inputs[path]=hash(b);return JSON.parse(path.endsWith('.bin')?gunzipSync(b):b);};
  const saleCatalog=verified('data/daily/catalog.bin',sale),rentalCatalog=verified('data/rental/catalog.bin',rental).complexes;
  ctx.NodoRental.normalizeDistricts(rentalCatalog);
  const codeHash=hash(Buffer.concat([read('tools/build-region-price-cache.mjs'),...models.map(n=>read('js/'+n+'.js'))]));
  const mapHash=hash(read('data/map/index.json')),membershipHash=hash(JSON.stringify(payload.d.map(c=>[c.id,c.r,c.admin,c.memberSources?.map(s=>s.id)])));inputs['data/map/index.json']=mapHash;
  let rentalMaxDate=rental.months.at(-1)+'-01';
  for(const region of ['41','11','28']){const path='data/rental/months/'+rental.months.at(-1)+'-'+region+'.bin';if(rental.sources[path])for(const row of verified(path,rental).rows){const day=ctx.NodoRental.iso(row[2]);if(day>rentalMaxDate)rentalMaxDate=day;}}

  for(const type of ['sale','jeonse','monthly']){
    const manifest=type==='sale'?sale:rental;
    for(const month of manifest.months.filter(m=>!months||months.includes(m)))for(const [r,region]of ['41','11','28'].entries()){
      const input=type==='sale'?`data/daily/${r}/${month}-state.bin`:`data/rental/months/${month}-${region}-state.bin`;
      if(!manifest.sources[input])continue;
      const raw=read(input),inputHash=hash(raw);if(inputHash!==manifest.sources[input])throw Error('Region cache input mismatch: '+input);inputs[input]=inputHash;
      const fingerprint=hash(JSON.stringify([codeHash,type==='sale'?membershipHash:null,manifest.sources[type==='sale'?'data/daily/catalog.bin':'data/rental/catalog.bin'],inputHash,type]));
      const name=`${month}-${region}-${type}.bin`,path=prefix+name,target=join(directory,name),stamp=target+'.json';let proof,bytes;
      try{proof=JSON.parse(readFileSync(stamp));if(proof.fingerprint===fingerprint&&hash(readFileSync(target))===proof.sha256)bytes=readFileSync(target);}catch{}
      if(!bytes){const shard=JSON.parse(gunzipSync(raw));const packed=type==='sale'?saleFrames(ctx,saleCatalog,payload,shard,month):rentalFrames(ctx,rentalCatalog,shard,month,region,type);bytes=gzipSync(JSON.stringify(packed),{level:6});writeFileSync(target,bytes);writeFileSync(stamp,JSON.stringify({fingerprint,sha256:hash(bytes)}));}
      if(type!=='sale'&&month===rental.months.at(-1)){const shard=JSON.parse(gunzipSync(raw));for(const row of shard.updates){const day=ctx.NodoRental.iso(row[2]);if(day>rentalMaxDate)rentalMaxDate=day;}}
      if(bytes.length>25*1024*1024)throw Error('Region cache asset exceeds limit');sources[path]=hash(bytes);assets.push({path,source:target,sha256:sources[path],size:bytes.length});
    }
  }
  assets.push({path:prefix+'index.json',bytes:Buffer.from(JSON.stringify({schema:1,versions:{sale:sale.version,rental:rental.version,map:payload.meta.sourceVersion},rentalMaxDate,inputs,sources}))});return assets;
}
