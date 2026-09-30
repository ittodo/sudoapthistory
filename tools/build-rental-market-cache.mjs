import {regionalReader} from './regional-data.mjs';
import {readFileSync,writeFileSync,existsSync,mkdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
const hash=b=>createHash('sha256').update(b).digest('hex');
const prefix='data/rental/market-cache/';
export function compactMarketShard(shard){return {schema:1,rows:shard.rows.filter(r=>!r[7]).map(r=>[r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[16],r[15],r[17]])};}
export function rentalMarketAssets(root){
  const source=join(root,'data/rental/index.json');if(!existsSync(source))return [];
  const reader=regionalReader(root,'rental'),manifest=reader.manifest,assets=[],sources={},inputs={},directory=join(root,'cloudflare/dist/rental-market-cache-v1');
 const codeHash=hash(Buffer.concat([readFileSync(join(root,'tools/build-rental-market-cache.mjs')),readFileSync(join(root,'tools/regional-data.mjs')),readFileSync(join(root,'js/regional-data.js'))]));
  for(const p of [join(root,'cloudflare'),join(root,'cloudflare/dist'),directory])if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('Symlink market cache output');
  mkdirSync(directory,{recursive:true});
  for(const month of manifest.months){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Invalid market month');for(const region of ['11','41','28']){
    const input=`data/rental/months/${month}-${region}.bin`,expected=manifest.schema===2?reader.fingerprint(input):manifest.sources[input];if(!expected)continue;
    const raw=manifest.schema===1?readFileSync(join(root,input)):null;if(raw&&hash(raw)!==expected)throw Error('Market input hash mismatch: '+input);if(raw)inputs[input]=expected;
    const name=`${month}-${region}.bin`,target=join(directory,name),stamp=target+'.json';let saved,bytes;try{saved=JSON.parse(readFileSync(stamp));}catch{}
    const fingerprint=hash(JSON.stringify([codeHash,expected]));
    if(saved?.inputHash===fingerprint&&existsSync(target)){const b=readFileSync(target);if(hash(b)===saved.hash)bytes=b;}
    if(!bytes){bytes=gzipSync(JSON.stringify(compactMarketShard(reader.read(input))),{level:6});writeFileSync(target,bytes);writeFileSync(stamp,JSON.stringify({inputHash:fingerprint,hash:hash(bytes)}));}
    if(bytes.length>25*1024*1024)throw Error('Market asset exceeds 25 MiB');const path=prefix+name;sources[path]=hash(bytes);assets.push({path,source:target,sha256:sources[path],size:bytes.length});
  }}
  const sale=join(root,'data/market.json');const saleStartYear=existsSync(sale)?JSON.parse(readFileSync(sale)).meta.startYear:2006;
  for(const p of ['data/rental/catalog.bin','data/rental/rates.json'])if(manifest.sources[p])inputs[p]=manifest.sources[p];
  Object.assign(inputs,reader.inputs);assets.push({path:prefix+'index.json',bytes:Buffer.from(JSON.stringify({schema:1,sourceVersion:manifest.version,months:manifest.months,saleStartYear,inputs,sources}))});return assets;
}
