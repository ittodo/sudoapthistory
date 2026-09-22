import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import '../js/rental-model.js';
const hash=b=>createHash('sha256').update(b).digest('hex');

// Consume the already generated latest-state snapshot, not the transaction ledger.
export function latestRent(shard,catalog,identities){
  const M=globalThis.NodoRental,state=new Map(),result=new Map();
  for(const row of [...shard.opening,...shard.updates])state.set([row[0],row[1],row[4]>0,row[5]].join(':'),row);
  for(const row of state.values()){
    const t=M.decode(row,catalog),entity=identities.get(t.c?.id);if(!entity||t.cancelled)continue;
    const type=t.rent>0?'monthly':'jeonse',area=Math.round(t.area),key=JSON.stringify([entity.id,area,type]),old=result.get(key);
    if(old&&(old.date>t.date||old.date===t.date&&String(old.transactionId)>=String(t.id)))continue;
    result.set(key,{id:entity.id,area,type,date:t.date,exactArea:t.area,sourceId:t.c.id,transactionId:t.id,deposit:t.deposit,rent:t.rent,value:M.metric(t,{type,convert:true}),equivalent:type==='monthly'?M.depositEquivalent(t):null,rate:t.rate,rateMonth:t.rateMonth});
  }
  return [...result.values()];
}

export function homeSearchAssets(root,search){
  if(!existsSync(join(root,'data/rental/index.json')))return [];
  const read=p=>readFileSync(join(root,p)),manifest=JSON.parse(read('data/rental/index.json')),inputs={...search.sources},sources={},assets=[];
  const verified=p=>{const bytes=read(p);if(hash(bytes)!==manifest.sources[p])throw Error('Home search input changed: '+p);inputs[p]=hash(bytes);return JSON.parse(p.endsWith('.bin')?gunzipSync(bytes):bytes);};
  const catalog=verified('data/rental/catalog.bin').complexes,identities=new Map(search.apartments.flatMap(e=>e.rentalIds.map(id=>[id,e]))),month=manifest.months.at(-1);
  const metadata=new Map(JSON.parse(read('data/housing-v3/index.json')).complexes.map(c=>[c.publicationId,c]));
  const rentalById=new Map(catalog.map(c=>[c.id,c]));
  const common=search.apartments.map(e=>{
    const approved=metadata.get(e.id),sources=e.rentalIds.map(id=>rentalById.get(id)).filter(Boolean);
    const unique=key=>{const values=[...new Set(sources.map(c=>c[key]).filter(v=>Number.isFinite(v)&&v>0))];return values.length===1?values[0]:null;};
    return {...e,units:approved?.units??unique('tu'),built:unique('b'),rental:approved?.tenure==='rental'};
  });
  let asOf=month+'-01';
  for(const region of ['41','11','28']){
    const shard=verified(`data/rental/months/${month}-${region}-state.bin`),prices=latestRent(shard,catalog,identities);
    for(const t of prices)if(t.date>asOf)asOf=t.date;
    const apartments=common.filter(e=>['41','11','28'][e.r]===region);
    const bytes=gzipSync(JSON.stringify({schema:1,apartments,prices}),{level:6}),path=`data/search/latest-${region}.bin`;
    if(bytes.length>25*1024*1024)throw Error('Home search asset exceeds limit');sources[path]=hash(bytes);assets.push({path,bytes});
  }
  // Pin catalogs and the original sale row index as well as the current rental snapshot.
  for(const [p,h]of Object.entries(inputs))if(hash(read(p))!==h)throw Error('Home search input changed: '+p);
  assets.push({path:'data/search/latest-index.json',bytes:Buffer.from(JSON.stringify({schema:1,asOf,searchVersion:search.version,rentalVersion:manifest.version,inputs,sources}))});return assets;
}
