import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export function verifyRentalData(root){
 const path=join(root,'data/rental/index.json');
 if(!existsSync(path)){if(existsSync(join(root,'js/rental-app.js')))throw Error('Rental UI requires its data manifest');return;}
 const m=JSON.parse(readFileSync(path));
 if(m.schema!==1||!m.months?.length||!m.sources)throw Error('Invalid rental manifest');
 for(const required of ['catalog.bin','rates.json','summary.json'])if(!m.sources['data/rental/'+required])throw Error('Missing rental source '+required);
 for(const month of m.months){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Invalid rental month');for(const region of ['11','41','28'])for(const suffix of ['','-state'])if(!m.sources[`data/rental/months/${month}-${region}${suffix}.bin`])throw Error('Missing rental month shard');}
 for(const [name,hash]of Object.entries(m.sources)){
  if(!/^data\/rental\/[\w/.-]+\.(bin|json)$/.test(name)||name.includes('..'))throw Error('Unsafe rental path');
  const bytes=readFileSync(join(root,name));if(bytes.length>25*1024*1024||createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Rental hash/size mismatch: '+name);
 }
 return {files:Object.keys(m.sources).length,version:m.version};
}
