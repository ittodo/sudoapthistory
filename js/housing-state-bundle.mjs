// One region/year file; each service keeps its existing gzip state bytes.
const magic='PGSTBND1',kinds=['daily','rental'];
const fail=()=>{throw Error('Invalid annual state bundle');};
export function isStateBundle(bytes){return bytes?.byteLength>=12&&new TextDecoder().decode(bytes.subarray(0,8))===magic;}
export function stateBundle(bytes,expected){
 if(!isStateBundle(bytes))fail();
 const n=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(8,true);
 if(n>1048576||n>bytes.byteLength-12)fail();
 const h=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(12,12+n)));
 if(h.schema!==1||!/^\d{5}$/.test(h.lawd)||!/^\d{4}$/.test(h.year)||!h.sections||Object.keys(h.sections).some(k=>!kinds.includes(k)))fail();
 if(expected&&(h.lawd!==expected.lawd||expected.year&&h.year!==expected.year))fail();
 let cursor=0;const sections={};
 for(const kind of kinds){const p=h.sections[kind];if(!p)continue;
  if(p.offset!==cursor||!Number.isSafeInteger(p.length)||p.length<2||!/^([a-f0-9]{64})$/.test(p.sha256)||12+n+cursor+p.length>bytes.length)fail();
  const offset=12+n+cursor;if(bytes[offset]!==31||bytes[offset+1]!==139)fail();
  sections[kind]={offset,length:p.length,sha256:p.sha256,total:bytes.length};cursor+=p.length;
 }
 if(!cursor||12+n+cursor!==bytes.length)fail();
 return {lawd:h.lawd,year:h.year,sections,part(kind){const p=sections[kind];if(!p)fail();return bytes.subarray(p.offset,p.offset+p.length);}};
}
export function encodeStateBundle(lawd,year,parts){
 if(Object.keys(parts).some(k=>!kinds.includes(k)))fail();
 let offset=0;const sections={};
 for(const kind of kinds){const p=parts[kind];if(!p)continue;sections[kind]={offset,length:p.bytes.length,sha256:p.sha256};offset+=p.bytes.length;}
 const header=new TextEncoder().encode(JSON.stringify({schema:1,lawd,year,sections}));
 const bytes=new Uint8Array(12+header.length+offset);bytes.set(new TextEncoder().encode(magic));new DataView(bytes.buffer).setUint32(8,header.length,true);bytes.set(header,12);
 for(const kind of kinds)if(parts[kind])bytes.set(parts[kind].bytes,12+header.length+sections[kind].offset);
 stateBundle(bytes,{lawd,year});return bytes;
}
export async function statePayload(bytes,kind,lawd){
 if(!isStateBundle(bytes))return bytes;
 const part=stateBundle(bytes,{lawd}).part(kind);
 return new Uint8Array(await new Response(new Blob([part]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
