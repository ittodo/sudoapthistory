// Local successful packaging receipts, never a public baseline/overlay format.
import{readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,lstatSync,renameSync}from'node:fs';
import{join,resolve}from'node:path';import{createHash}from'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex'),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function yearMemo(directory,key,code,year){
 if(!/^\d{5}$/.test(code)||!/^\d{4}$/.test(year))throw Error('Year packing scope invalid');
 const digest=hash(JSON.stringify(key)),target=directory?join(resolve(directory),'native-years',digest):null;
 const allowed=p=>new RegExp('^data/daily/regions/'+code+'/(?:quarters/'+year+'-Q[1-4](?:-p[01]+|-order)?\\.bin|quarters/'+year+'-Q[1-4]\\.parts\\.json|states/(?:daily|rental)/'+year+'(?:-p[01]+|-order)?\\.bin|states/(?:daily|rental)/'+year+'\\.parts\\.json)$').test(p);
 function safe(p){if(lstatSync(p).isSymbolicLink()||realpathSync(p).toLowerCase()!==p.toLowerCase())throw Error('Year packing cache link');}
 return{
  load(identity,emit){
   if(!target||process.env.NODO_FULL_VERIFY==='1'||!existsSync(join(target,'receipt.json')))return null;
   safe(target);safe(join(target,'receipt.json'));const stored=JSON.parse(readFileSync(join(target,'receipt.json'))),b=stored.body;
   if(stored.sha256!==hash(JSON.stringify(b))||b.schema!==1||b.key!==digest||b.code!==code||b.year!==year||b.status!=='PASS')throw Error('Year packing receipt mismatch');
   if(b.identity.complexes.some((v,i)=>!equal(identity.complexes[i],v)))return null;
   const area=identity.areas.slice();for(const[i,v]of b.identity.areas.entries()){if(i<area.length){if(!equal(area[i],v))return null;}else area.push(v);}
   const assets=[];for(const[p,r]of Object.entries(b.files)){if(!allowed(p)||!/^\d+\.bin$/.test(r.file))throw Error('Year packing cache path');
    const file=join(target,r.file);safe(file);if(lstatSync(file).size>25*1024*1024)throw Error('Year packing cache size');
    const bytes=readFileSync(file);if(hash(bytes)!==r.sha256||bytes.length!==r.bytes)throw Error('Year packing cache bytes changed');assets.push([p,bytes]);
   }
   for(const entries of [b.quarters,b.states.daily,b.states.rental])for(const[m,p]of Object.entries(entries)){if(!m.startsWith(year+'-')||p!==null&&!b.files[p])throw Error('Year packing asset missing');}
   identity.areas=area;for(const[p,bytes]of assets)emit(p,bytes);return b;
  },
  save(identity,quarters,states,metrics,files){
   if(!target)return;mkdirSync(target,{recursive:true});safe(target);const records={};let n=0;
   for(const[p,bytes]of files){if(!allowed(p))throw Error('Year packing output scope');const file=(n++)+'.bin',dest=join(target,file);if(existsSync(dest))safe(dest);writeFileSync(dest,bytes);records[p]={file,sha256:hash(bytes),bytes:bytes.length};}
   const body={schema:1,key:digest,code,year,status:'PASS',identity,quarters,states,metrics,files:records},temp=join(target,'receipt.'+process.pid+'.tmp');
   writeFileSync(temp,JSON.stringify({body,sha256:hash(JSON.stringify(body))}));renameSync(temp,join(target,'receipt.json'));
  }
 };
}
