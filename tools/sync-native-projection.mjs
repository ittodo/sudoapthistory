// Export the canonical operating implementation for CI; never edit vendor files.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const source=resolve(process.argv[2]||'../15_26/rust'),dest=resolve('tools/native-projection');
const hash=b=>createHash('sha256').update(b).digest('hex'),files={};
mkdirSync(join(dest,'vendor'),{recursive:true});
for(const name of ['daily.rs','rental.rs','apartment_rent.rs','month_ledger.rs','pipeline_guard.rs','regional.rs','calc_suffix.rs']){
 const raw=readFileSync(join(source,'src',name));let bytes=raw,selection='whole';
 if(name==='pipeline_guard.rs'){
  const mark=Buffer.from('pub fn collect_contracts('),end=raw.indexOf(mark);
  if(end<0)throw Error('Guard boundary changed');bytes=raw.subarray(0,end);selection='before collect_contracts';
 }
 writeFileSync(join(dest,'vendor',name),bytes);files[name]={sourceSha256:hash(raw),exportSha256:hash(bytes),selection};
}
// Keep the independently named CI package's pinned lock; every registry package
// must be an exact version/checksum subset of the reviewed operating lock.
const canonicalLock=readFileSync(join(source,'Cargo.lock')),exportLock=readFileSync(join(dest,'Cargo.lock'));
const registryPackages=bytes=>bytes.toString('utf8').split('[[package]]').slice(1).filter(s=>/^source = /m.test(s)).map(s=>['name','version','source','checksum'].map(k=>s.match(new RegExp('^'+k+' = "([^"\\r\\n]+)"','m'))?.[1]||'').join('|'));
const pinned=new Set(registryPackages(canonicalLock));for(const entry of registryPackages(exportLock))if(!pinned.has(entry))throw Error('CI dependency lock differs from reviewed operating source: '+entry.split('|').slice(0,2).join('@'));
writeFileSync(join(dest,'provenance.json'),JSON.stringify({schema:1,canonicalLockSha256:hash(canonicalLock),exportLockSha256:hash(exportLock),sourceCommit:execFileSync('git',['-c','safe.directory='+resolve(source,'..').replaceAll('\\','/'),'rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),files},null,2)+'\n');
console.log('Exported canonical projection modules; run native tests before committing.');
