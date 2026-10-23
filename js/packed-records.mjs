import {encodeColumns,openColumns,schemas} from './generated/transport-columns.mjs';

export const FORMAT='packed-records-v1',MAGIC='PGRCD001';
const utf8=new TextEncoder(),text=new TextDecoder('utf-8',{fatal:true}),HEADER=20,MAX_DEPTH=128;
const compare=(a,b)=>a<b?-1:a>b?1:0;
function string(value){if(typeof value!=='string'||(value.isWellFormed?!value.isWellFormed():text.decode(utf8.encode(value))!==value))throw Error('Invalid record string');return value;}

// Each node stores its subtree length. Relative lengths compress without the
// monotonically changing offsets of scalar nodes. Child trees can be skipped without
// constructing their values. The generated columns hold exact f64s and strings.
export function encodeRecords(entries){
 const records=[...entries].sort(([a],[b])=>compare(a,b)),index=[],nodes=[],ancestors=new Set();let previous;
 function add(value,key=null,depth=0){
  if(depth>MAX_DEPTH)throw Error('Record nesting exceeds limit');
  const id=nodes.length,row=[0,0,key,null,null];nodes.push(row);
  if(value===null)row[0]=0;
  else if(typeof value==='boolean')row[0]=value?2:1;
  else if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Finite record number required');row[0]=3;row[3]=value;}
  else if(typeof value==='string'){row[0]=4;row[4]=string(value);}
  else if(typeof value==='object'){
   if(ancestors.has(value))throw Error('Cyclic record value');
   if(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Plain record object required');
   ancestors.add(value);
   if(Array.isArray(value)){row[0]=5;for(const child of value)add(child,null,depth+1);}
   else {row[0]=6;for(const name of Object.keys(value))add(value[name],string(name),depth+1);}
   ancestors.delete(value);
  }else throw Error('Unsupported record value');
  row[1]=nodes.length-id;return id;
 }
 for(const [key,value]of records){string(key);if(key===previous)throw Error('Duplicate record key');previous=key;index.push([key,add(value)]);}
 const a=encodeColumns(schemas.RecordIndex,index),b=encodeColumns(schemas.ValueNode,nodes),out=new Uint8Array(HEADER+a.length+b.length),view=new DataView(out.buffer);
 out.set(utf8.encode(MAGIC));view.setUint32(8,1,true);view.setUint32(12,a.length,true);view.setUint32(16,b.length,true);out.set(a,HEADER);out.set(b,HEADER+a.length);return out;
}

export function openRecords(input){
 const bytes=ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):new Uint8Array(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length<HEADER||text.decode(bytes.subarray(0,8))!==MAGIC||view.getUint32(8,true)!==1)throw Error('Invalid record container');
 const a=view.getUint32(12,true),b=view.getUint32(16,true);
 if(HEADER+a+b!==bytes.length)throw Error('Invalid record section lengths');
 const index=openColumns(schemas.RecordIndex,bytes.subarray(HEADER,HEADER+a)),nodes=openColumns(schemas.ValueNode,bytes.subarray(HEADER+a));
 const [keyColumn,rootColumn]=index.columns,[kind,span,key,number,value]=nodes.columns;
 const end={get:id=>id+span.get(id)};
 let lastKey,lastEnd=0;
 for(let i=0;i<index.rowCount;i++){
  const k=keyColumn.get(i),root=rootColumn.get(i);if(i&&compare(lastKey,k)>=0||root!==lastEnd||root>=nodes.rowCount||key.get(root)!==null)throw Error('Invalid record index');
  lastKey=k;lastEnd=end.get(root);if(lastEnd<=root||lastEnd>nodes.rowCount)throw Error('Invalid record root');
 }
 if(lastEnd!==nodes.rowCount)throw Error('Unreferenced record nodes');
 function read(id,limit,depth=0){
  if(depth>MAX_DEPTH||id>=limit)throw Error('Invalid record nesting');
  const type=kind.get(id),stop=end.get(id),n=number.get(id),s=value.get(id);
  if(stop<=id||stop>limit||type>6||type!==3&&n!==null||type!==4&&s!==null)throw Error('Invalid record node');
  if(type<5){if(stop!==id+1)throw Error('Invalid scalar range');if(type===0)return null;if(type===1)return false;if(type===2)return true;if(type===3){if(n===null)throw Error('Missing record number');return n;}if(s===null)throw Error('Missing record string');return s;}
  const result=type===5?[]:{};let child=id+1;
  while(child<stop){
   const name=key.get(child);if(type===5){if(name!==null)throw Error('Unexpected array key');result.push(read(child,stop,depth+1));}
   else {if(name===null||Object.hasOwn(result,name))throw Error('Invalid object key');Object.defineProperty(result,name,{value:read(child,stop,depth+1),enumerable:true,writable:true,configurable:true});}
   child=end.get(child);
  }
  return result;
 }
 return {count:index.rowCount,keys(){return Array.from({length:index.rowCount},(_,i)=>keyColumn.get(i));},get(wanted){
  if(typeof wanted!=='string')throw Error('Record key must be a string');let lo=0,hi=index.rowCount;
  while(lo<hi){const mid=(lo+hi)>>>1,c=compare(keyColumn.get(mid),wanted);if(c<0)lo=mid+1;else hi=mid;}
  if(lo===index.rowCount||keyColumn.get(lo)!==wanted)return undefined;
  const root=rootColumn.get(lo);return read(root,end.get(root));
 }};
}
