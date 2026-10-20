import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as codec from '../js/generated/housing-columns.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function verifyContractArchive(root,archive){
 if(!archive)return null;if(archive.schema!==1)throw Error('Invalid contract archive version');let rows=0;const expected=new Set();
 const read=p=>{let target=root;for(const part of p.split('/')){if(!part||part==='..'||part==='.'||/[\\:]/.test(part))throw Error('Unsafe archive path');target=join(target,part);if(lstatSync(target).isSymbolicLink())throw Error('Linked contract archive');}const bytes=readFileSync(target);if(bytes.length>20*1024*1024||hash(bytes)!==archive.sources[p])throw Error('Contract archive digest/size mismatch');expected.add(p);return gunzipSync(bytes);};
 for(const[code,path]of Object.entries(archive.regions)){if(!/^\d{5}$/.test(code)||path!==`data/contracts/apartment-rent/${code}/archive-details.bin`)throw Error('Invalid contract archive scope');rows+=codec.openColumns(codec.schemas.ContractDetail,read(path)).rowCount;}
 const coverage=archive.coverageRef;if(coverage?.path!=='data/contracts/apartment-rent/coverage.bin'||coverage.sha256!==archive.sources[coverage.path])throw Error('Invalid archive coverage');JSON.parse(read(coverage.path));
 if(rows!==archive.rows||Object.keys(archive.sources).length!==expected.size||Object.keys(archive.sources).some(p=>!expected.has(p)))throw Error('Orphan contract archive source');return {status:'PASS',rows,files:expected.size};
}
