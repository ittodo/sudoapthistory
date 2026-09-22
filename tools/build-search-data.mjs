import {homeSearchAssets} from './build-home-search-data.mjs';
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {buildSync} from 'esbuild';
import '../js/rental-model.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const order = (a,b) => a < b ? -1 : a > b ? 1 : 0;

// Only existing identity links join entities. Names and coordinates never do.
export function combineCatalogs({sale = [], rental = [], rows = [], map = [], metadata = [], lookup = {}, ambiguous = []}) {
  const all = [...sale, ...rental].map(c => ({...c}));
  globalThis.NodoRental.normalizeDistricts(all);
  const entities = new Map();
  const conflicts = new Set(ambiguous);
  function canonical(source, publicId, rentalOnly = false) {
    if(conflicts.has(source))return source;
    return lookup[source]?.[0] || lookup[publicId]?.[0] || publicId || (rentalOnly ? 'rental:' + source : source);
  }
  function add(source, publicId, c, kind) {
    if (!source) return;
    const id = canonical(source, publicId, kind === 'rental' && !publicId);
    let e = entities.get(id);
    if (!e) entities.set(id,e = {id,name:c.n || '',aliases:new Set(),r:c.r,g:c.g || '',d:c.d || '',addresses:new Set(),keys:new Set([id]),saleIds:new Set(),rentalIds:new Set(),mapIds:new Set(),rows:new Set()});
    if (c.n) {e.name ||= c.n;e.aliases.add(c.n);}
    for (const n of c.aliases || []) if (typeof n === 'string') e.aliases.add(n);
    e.g ||= c.g || ''; e.d ||= c.d || ''; e.r ??= c.r;
    e.keys.add(source); if (publicId && !conflicts.has(source)) e.keys.add(publicId);
    if (kind === 'sale') e.saleIds.add(source);
    if (kind === 'rental') e.rentalIds.add(source);
    if (c.mapId) e.mapIds.add(c.mapId);
    if (c.coord) e.coord ||= c.coord;
    for (const a of [c.address,c.rd,c.j]) if (a) e.addresses.add(String(a));
    return e;
  }
  for (const c of all.slice(0,sale.length)) add(c.id,c.publicId,c,'sale');
  for (const c of all.slice(sale.length)) add(c.id,c.publicId,c,'rental');
  rows.forEach((c,i) => {const e = add(c.as,c.as,c,'sale');if(e)e.rows.add(c.i ?? i);});
  for (const c of metadata) {
    if(c.housingFamily!=='apartment')continue;
    const e=add(c.id,c.publicationId,{n:c.name,r:({'경기':0,'서울':1,'인천':2})[c.region],g:c.gu,d:c.dong,address:c.lotAddress,rd:c.roadAddress},'metadata');
    e.name=c.name;
  }
  for(const [alias,[id]] of Object.entries(lookup))entities.get(id)?.keys.add(alias);
  for (const c of map) {
    for (const source of c.memberSources?.length ? c.memberSources : [c]) {
      const id = canonical(source.id,source.publicId);
      const e = entities.get(id);
      if (!e) continue;
      e.mapIds.add(c.id); e.coord ||= c.coord;
      // A publication name is an alias only when the catalog confirms this link.
      if (lookup[c.id]?.[0] === e.id || c.id === e.id) {e.aliases.add(c.n);e.name=c.n;}
      for (const a of [c.rd,c.j,source.rd,source.j]) if (a) e.addresses.add(String(a));
    }
  }
  return [...entities.values()].map(e => ({...e,
    aliases:[...e.aliases].filter(n=>n && n!==e.name).sort(order),
    addresses:[...e.addresses].sort(order), keys:[...e.keys].sort(order),
    saleIds:[...e.saleIds].sort(order),rentalIds:[...e.rentalIds].sort(order),mapIds:[...e.mapIds].sort(order),rows:[...e.rows].sort((a,b)=>a-b)
  })).sort((a,b)=>order(a.id,b.id));
}

export function searchData(root) {
  const sources = {};
  const read = path => {
    const bytes = readFileSync(join(root,path));sources[path] = hash(bytes);
    return JSON.parse(path.endsWith('.bin') ? gunzipSync(bytes) : bytes);
  };
  const index = read('data/index.json'), identities = read('data/apartments/index.json');
  const sale = read('data/daily/catalog.bin'), rental = read('data/rental/catalog.bin'), map = read('data/map/index.json');
  const metadata=read('data/housing-v3/index.json');
  if(metadata.meta?.approvedOnly!==true)throw Error('Search metadata must use approved apartment identities');
  const apartments = combineCatalogs({sale:sale.complexes,rental:rental.complexes,rows:index.d,map:map.d,metadata:metadata.complexes,lookup:identities.lookup,ambiguous:identities.ambiguous});
  if (!apartments.length || apartments.some(c=>!c.name || !c.id || ![0,1,2].includes(c.r) || !c.g || /^\d{5}$/.test(c.g))) throw Error('Invalid apartment search catalog');
  const payload = {schema:1,version:hash(JSON.stringify({schema:1,sources,apartments})),sources,apartments};
  return Buffer.from(JSON.stringify(payload));
}

export function searchAssets(root) {
  if (!existsSync(join(root,'js/apartment-search-worker.js'))) return [];
  const bytes = searchData(root);
  const bundle = buildSync({entryPoints:[join(root,'js/apartment-search-worker.js')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'inline'}).outputFiles[0].contents;
  // Include the pinned library's license in the self-hosted bundle.
  const license = readFileSync(join(root,'node_modules/es-hangul/LICENSE'),'utf8').replaceAll('*/','* /');
  return [...homeSearchAssets(root,JSON.parse(bytes)),{path:'data/search/apartments.json',bytes},{path:'js/apartment-search-worker.bundle.js',bytes:Buffer.concat([Buffer.from('/*! es-hangul 2.4.0\n'+license+'\n*/\n'),Buffer.from(bundle)])}];
}
