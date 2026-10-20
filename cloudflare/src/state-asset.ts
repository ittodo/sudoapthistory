// Static Assets currently ignores Range. Limit this adapter to annual map states.
// Production bindings can omit Content-Length even when the edge later adds it.
async function stateLength(response:Response):Promise<{response:Response,total:number}>{
 let total=Number(response.headers.get('Content-Length'));
 if(total>0||!response.body)return {response,total};
 const reader=response.body.getReader(),prefix:Uint8Array[]=[];let size=0,done=false;
 const ensure=async(n:number)=>{while(size<n&&!done){const next=await reader.read();done=next.done;if(next.value){prefix.push(next.value);size+=next.value.byteLength;}}return size>=n;};
 const bytes=()=>{const b=new Uint8Array(size);let offset=0;for(const p of prefix){b.set(p,offset);offset+=p.byteLength;}return b;};
 const headers=new Headers(response.headers);
 if(await ensure(12)){
  const first=bytes(),length=new DataView(first.buffer).getUint32(8,true);
  if(new TextDecoder().decode(first.subarray(0,8))==='PGSTBND1'&&length>0&&length<=65536&&await ensure(12+length)){
   try{const header=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes().subarray(12,12+length)));let offset=0;
    if(header.schema!==1||!/^\d{5}$/.test(header.lawd)||!/^\d{4}$/.test(header.year)||!header.sections||Object.keys(header.sections).some(k=>!['daily','rental'].includes(k)))throw Error('Invalid state header');
    for(const kind of ['daily','rental']){const p=header.sections[kind];if(!p)continue;if(p.offset!==offset||!Number.isSafeInteger(p.length)||p.length<2||!/^([a-f0-9]{64})$/.test(p.sha256))throw Error('Invalid state section');offset+=p.length;}
    const expected=12+length+offset;if(offset>0&&Number.isSafeInteger(expected)&&expected<=20*1024*1024&&size<=expected)total=expected;
   }catch{/* Preserve the full response when the asset is not an annual bundle. */}
  }
 }
 let index=0;const body=new ReadableStream<Uint8Array>({async pull(controller){if(index<prefix.length){controller.enqueue(prefix[index++]);return;}if(done){controller.close();return;}try{const next=await reader.read();if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){controller.error(error);}},cancel(reason){return reader.cancel(reason);}});
 return {response:new Response(body,{status:response.status,statusText:response.statusText,headers}),total};
}
export async function stateAsset(request:Request,assets:Fetcher):Promise<Response>{
 const match=request.method==='GET'&&request.headers.get('Range')?.match(/^bytes=(\d+)-(\d+)$/);
 if(!match)return assets.fetch(request);
 const source=new Request(request),headers=source.headers;
 headers.delete('Range');headers.delete('If-Range');headers.set('Accept-Encoding','identity');
 let response=await assets.fetch(source);
 if(response.status!==200||!response.body||!['','identity'].includes(response.headers.get('Content-Encoding')||''))return response;
 const condition=request.headers.get('If-Range');
 if(condition&&condition!==response.headers.get('ETag')&&condition!==response.headers.get('Last-Modified'))return response;
 const sized=await stateLength(response);response=sized.response;
 if(!response.body)return response;
 const total=sized.total,start=Number(match[1]),requestedEnd=Number(match[2]);
 if(!Number.isSafeInteger(total)||total<=0)return response;
 const out=new Headers(response.headers);out.set('Accept-Ranges','bytes');
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(requestedEnd)||start>requestedEnd||start>=total){await response.body.cancel();out.set('Content-Range',`bytes */${total}`);out.set('Content-Length','0');return new Response(null,{status:416,headers:out});}
 const end=Math.min(requestedEnd,total-1),reader=response.body.getReader();let position=0;
 const body=new ReadableStream<Uint8Array>({async pull(controller){
  try{for(;;){const {value,done}=await reader.read();if(done){controller.error(new Error('Incomplete state asset'));return;}
   const from=Math.max(0,start-position),to=Math.min(value.byteLength,end+1-position);position+=value.byteLength;
   if(to>from)controller.enqueue(value.subarray(from,to));
   if(position>end){controller.close();await reader.cancel();return;}if(to>from)return;
  }}catch(error){controller.error(error);}
 },cancel(reason){return reader.cancel(reason);}});
 out.set('Content-Range',`bytes ${start}-${end}/${total}`);out.set('Content-Length',String(end-start+1));
 return new Response(body,{status:206,headers:out});
}
