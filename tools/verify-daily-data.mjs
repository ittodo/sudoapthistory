import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';

export function verifyDailyData(root){
  root=resolve(root);
  const path=resolve(root,'data/daily/index.json');
  if(!existsSync(path))return null;
  const index=JSON.parse(readFileSync(path,'utf8'));
  if(index.schema!==1||index.encoding!=='gzip-json'||!index.months?.length||!index.sources?.['data/daily/catalog.bin'])throw Error('Invalid daily data manifest');
  let bytes=0;
  for(const [name,expected]of Object.entries(index.sources)){
    const file=resolve(root,name);
    if(!file.startsWith(root+sep)||(!name.startsWith('data/daily/')&&name!=='data/map/index.json'))throw Error('Invalid daily source path');
    const content=readFileSync(file);
    if(createHash('sha256').update(content).digest('hex')!==expected)throw Error('Daily source changed: '+name);
    if(content.length>25*1024*1024)throw Error('Daily source exceeds asset size limit');
    bytes+=content.length;
  }
  for(const month of index.months)for(const region of [0,1,2])for(const suffix of ['','-state'])
    if(!index.sources[`data/daily/${region}/${month}${suffix}.bin`])throw Error('Missing daily month shard');
  return {version:index.version,files:Object.keys(index.sources).length,bytes,active:index.counts.active};
}
