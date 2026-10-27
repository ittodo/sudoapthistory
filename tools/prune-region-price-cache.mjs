// Explicit maintenance after a complete build. Never opens a source/review DB.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync,lstatSync,readdirSync,unlinkSync,statSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const scope='cloudflare/dist/region-price-cache-v2',retired=['cloudflare/dist/region-price-cache-v1','cloudflare/dist/region-price-reference-v1'];
const prefix='data/map/price-cache/',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const cacheFile=/^\d{4}-(?:\d{2}|Q[1-4])-(?:41|11|28)-(?:sale|jeonse|monthly)\.bin(?:\.json|\.groups\.bin(?:\.json)?|\.bindings\.bin)?$/;
function plain(path){for(let p=resolve(path);p!==dirname(p);p=dirname(p))if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('Linked cache path is not allowed');}
export function pruneRegionPriceCache(root,{apply=false}={}){
 root=resolve(root);const file=join(root,'cloudflare/dist/housing-cache.sqlite');plain(file);
 if(process.env.NODO_CACHE_DB&&resolve(process.env.NODO_CACHE_DB)!==file)throw Error('Cleanup only supports the site-local CI cache');
 const load=p=>JSON.parse(readFileSync(join(root,p))),sale=load('data/daily/index.json'),rental=load('data/rental/index.json'),index=load('cloudflare/dist/public/'+prefix+'index.json'),build=load('cloudflare/dist/build-timings.json');
 if(sale.schema!==3||rental.schema!==3||index.schema!==2||build.fullVerification!==false||!build.regionPriceStats?.phaseTimings)throw Error('Complete current schema-3 price build required');
 if(process.env.GITHUB_SHA&&build.gitSha!==process.env.GITHUB_SHA)throw Error('Build commit mismatch');
 const wanted=new Set(['latest-rental.json']),quarters=new Set(),monthNames=[];
 for(const [type,manifest] of [['sale',sale],['jeonse',rental],['monthly',rental]])for(const month of manifest.months){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Invalid source month');
  for(const region of ['41','11','28']){
   const name=month+'-'+region+'-'+type+'.bin';monthNames.push(name);
   for(const suffix of ['', '.json','.bindings.bin','.groups.bin','.groups.bin.json'])wanted.add(name+suffix);
   quarters.add(month.slice(0,4)+'-Q'+Math.ceil(Number(month.slice(5))/3)+'-'+region+'-'+type+'.bin');
  }
 }
 if(!monthNames.length||JSON.stringify([...quarters].map(p=>prefix+p).sort())!==JSON.stringify(Object.keys(index.quarterSources||{}).sort()))throw Error('Published quarter coverage differs from current months');
 for(const name of quarters){wanted.add(name);wanted.add(name+'.json');}
 const db=new DatabaseSync(file,{readOnly:!apply}),report={apply,removedEntries:0,removedPayloadBytes:0,removedFiles:0,removedFileBytes:0,retainedPriceEntries:wanted.size,databaseBytesBefore:statSync(file).size};
 try{
  db.exec('PRAGMA busy_timeout=1000');if(apply)db.exec('BEGIN IMMEDIATE');
  const get=db.prepare('SELECT payload,sha256 FROM calculation_cache WHERE scope=? AND key=?'),read=key=>{const row=get.get(scope,key);if(!row||hash(row.payload)!==row.sha256)throw Error('Missing or damaged current receipt: '+key);return JSON.parse(Buffer.from(row.payload));};
  const current=db.prepare('SELECT key,length(payload) AS bytes FROM calculation_cache WHERE scope=?').all(scope),present=new Set(current.map(x=>x.key));
  for(const key of wanted)if(!present.has(key))throw Error('Incomplete current cache: '+key);
  for(const name of monthNames){const receipt=read(name+'.json');if(receipt.schema!==3||!/^\w{64}$/.test(receipt.engine))throw Error('Old monthly cache remains: '+name);}
  for(const name of quarters)if(read(name+'.json').sha256!==index.quarterSources[prefix+name])throw Error('Quarter receipt differs from published build');
  const remove=current.filter(x=>!wanted.has(x.key)).map(x=>({...x,scope}));
  for(const old of retired)for(const row of db.prepare('SELECT key,length(payload) AS bytes FROM calculation_cache WHERE scope=?').all(old))remove.push({...row,scope:old});
  const files=[];
  for(const directory of [scope,...retired]){
   const path=join(root,directory);plain(path);if(!existsSync(path))continue;
   for(const entry of readdirSync(path,{withFileTypes:true})){
    const target=join(path,entry.name);plain(target);
    if(!entry.isFile()||!cacheFile.test(entry.name))throw Error('Unexpected cache entry: '+target);
    if(directory===scope&&quarters.has(entry.name))continue;
    files.push({path:target,bytes:statSync(target).size});
   }
  }
  report.removedEntries=remove.length;report.removedPayloadBytes=remove.reduce((n,x)=>n+x.bytes,0);report.removedFiles=files.length;report.removedFileBytes=files.reduce((n,x)=>n+x.bytes,0);
  if(apply){const del=db.prepare('DELETE FROM calculation_cache WHERE scope=? AND key=?');for(const row of remove)del.run(row.scope,row.key);db.exec('COMMIT');for(const item of files)unlinkSync(item.path);if(remove.length)db.exec('VACUUM');const checkpoint=db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();if(checkpoint.busy)throw Error('Cache checkpoint is busy');}
 }catch(error){if(apply&&db.isTransaction)db.exec('ROLLBACK');throw error;}finally{db.close();}
 report.databaseBytesAfter=statSync(file).size;return report;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);for(let i=0;i<args.length;i++)if(args[i]==='--root')i++;else if(args[i]!=='--apply')throw Error('Unknown cleanup argument');
 const at=args.indexOf('--root'),root=at<0?resolve(dirname(fileURLToPath(import.meta.url)),'..'):args[at+1];
 if(!root)throw Error('Missing root');console.log(JSON.stringify(pruneRegionPriceCache(root,{apply:args.includes('--apply')})));
}
