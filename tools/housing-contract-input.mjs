// Private parsed inventory only; detail PASS receipts still authorize output reuse.
import{readFileSync,writeFileSync,mkdirSync,existsSync,lstatSync,realpathSync,renameSync}from'node:fs';
import{join,resolve}from'node:path';import{createHash}from'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function contractInput(directory,engine,partition,bytes){
 const digest=hash(bytes),key=hash(JSON.stringify([engine,partition,digest])),target=directory?join(resolve(directory),'contract-inputs',key):null;
 let parsed=null,metadata=null;
 const rows=()=>{if(parsed===null){const v=JSON.parse(bytes);if(!Array.isArray(v.rows)||v.rows.length!==partition.count)throw Error('Contract count mismatch');parsed=v.rows;}return parsed;};
 const safe=p=>{if(lstatSync(p).isSymbolicLink()||realpathSync(p).toLowerCase()!==p.toLowerCase())throw Error('Contract input cache link');};
 if(target&&process.env.NODO_FULL_VERIFY!=='1'&&existsSync(join(target,'receipt.json'))){
  safe(target);safe(join(target,'receipt.json'));const receipt=JSON.parse(readFileSync(join(target,'receipt.json'))),b=receipt.body;
  if(!b||b.schema!==1||b.key!==key||b.state!=='PARSED'||b.digest!==digest||b.bytes!==bytes.length||b.count!==partition.count||receipt.sha256!==hash(JSON.stringify(b))||!Array.isArray(b.entities))throw Error('Contract input receipt mismatch');
  metadata=b;
 }
 const reused=metadata!==null;
 if(!metadata){
  const values=rows(),entities=[...new Set(values.map(v=>v.entityId))].sort();
  metadata={schema:1,key,state:'PARSED',digest,bytes:bytes.length,count:values.length,entities};
  if(target){mkdirSync(target,{recursive:true});safe(target);const temp=join(target,'receipt.'+process.pid+'.tmp');writeFileSync(temp,JSON.stringify({body:metadata,sha256:hash(JSON.stringify(metadata))}));renameSync(temp,join(target,'receipt.json'));}
 }
 return{digest,bytes:bytes.length,entities:metadata.entities,reused,rows,get parsed(){return parsed!==null;}};
}
